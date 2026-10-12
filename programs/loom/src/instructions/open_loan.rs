use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::constants::*;
use crate::error::LoomError;
use crate::events::*;
use crate::math;
use crate::merkle::is_field_element;
use crate::oracle::load_sol_usd_prices;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OpenLoanArgs {
    /// Client-chosen nonce; makes the loan PDA unique per borrower.
    pub nonce: u64,
    /// Stablecoin amount to borrow (6 decimals).
    pub principal: u64,
    /// SOL to lock in escrow. Must be worth >= 2x principal.
    pub collateral_lamports: u64,
    /// Poseidon(secret, nullifier) for ZK credit certificates, or all-zero to opt out.
    pub identity_commitment: [u8; 32],
}

#[derive(Accounts)]
#[instruction(args: OpenLoanArgs)]
pub struct OpenLoan<'info> {
    #[account(mut)]
    pub borrower: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = treasury)]
    pub config: Box<Account<'info, Config>>,
    /// Signs payouts as the delegate the treasury approved on its token account.
    #[account(mut, seeds = [RESERVE_SEED, mint.key().as_ref()], bump = reserve.bump, has_one = mint)]
    pub reserve: Box<Account<'info, Reserve>>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: the admin treasury (payout) wallet, pinned by `has_one = treasury`.
    pub treasury: UncheckedAccount<'info>,
    /// Payouts come straight from the treasury's token account, up to the amount it approved.
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = treasury,
        associated_token::token_program = token_program,
    )]
    pub treasury_token: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: any wallet the borrower chooses to receive the stablecoin (usually themselves).
    pub recipient: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = borrower,
        associated_token::mint = mint,
        associated_token::authority = recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = borrower,
        space = 8 + Loan::INIT_SPACE,
        seeds = [LOAN_SEED, borrower.key().as_ref(), &args.nonce.to_le_bytes()],
        bump,
    )]
    pub loan: Box<Account<'info, Loan>>,
    #[account(
        init,
        payer = borrower,
        space = 8 + CollateralEscrow::INIT_SPACE,
        seeds = [ESCROW_SEED, loan.key().as_ref()],
        bump,
    )]
    pub escrow: Account<'info, CollateralEscrow>,
    /// CHECK: Pyth SOL/USD PriceUpdateV2 — owner, discriminator, feed id,
    /// verification level, staleness and confidence are checked in `load_sol_usd_prices`.
    pub price_update: UncheckedAccount<'info>,
    /// CHECK: Chainlink SOL/USD feed — address pinned here; owner, layout and staleness checked in `load_sol_usd_prices`.
    #[account(address = CHAINLINK_SOL_USD_FEED @ LoomError::InvalidChainlinkFeed)]
    pub chainlink_feed: UncheckedAccount<'info>,
    /// Optional ZK repayment certificate held by the borrower: unlocks CREDIT_INTEREST_BPS on loans
    /// up to CREDIT_LIMIT_MULTIPLE x the repaid principal it proves. Only `claim_certificate` can create one.
    pub credit_certificate: Option<Box<Account<'info, CreditCertificate>>>,
    /// Lending pool for this stablecoin, if one exists: loans are funded from it first.
    #[account(mut, seeds = [POOL_SEED, mint.key().as_ref()], bump = pool.bump, has_one = mint @ LoomError::InvalidPool)]
    pub pool: Option<Box<Account<'info, Pool>>>,
    #[account(mut)]
    pub pool_vault: Option<Box<InterfaceAccount<'info, TokenAccount>>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn process_open_loan(ctx: Context<OpenLoan>, args: OpenLoanArgs) -> Result<()> {
    let config = &ctx.accounts.config;
    require!(!config.paused, LoomError::Paused);
    require!(
        args.principal >= config.min_principal && args.principal <= config.max_principal,
        LoomError::PrincipalOutOfRange
    );
    require!(args.collateral_lamports > 0, LoomError::ZeroAmount);
    require!(is_field_element(&args.identity_commitment), LoomError::InvalidCommitment);
    require!(ctx.accounts.recipient.key() != ctx.accounts.treasury.key(), LoomError::InvalidRecipient);

    // Funded by the lending pool when it has the cash, otherwise by the treasury's approved payouts.
    let from_pool = match (&ctx.accounts.pool, &ctx.accounts.pool_vault) {
        (Some(pool), Some(vault)) => {
            require_keys_eq!(vault.key(), pool.vault, LoomError::InvalidPool);
            pool.cash >= args.principal
        }
        _ => false,
    };
    if !from_pool {
        let source = &ctx.accounts.treasury_token;
        require!(source.amount >= args.principal, LoomError::InsufficientLiquidity);
        let approved = match source.delegate {
            COption::Some(delegate) if delegate == ctx.accounts.reserve.key() => source.delegated_amount,
            _ => 0,
        };
        require!(approved >= args.principal, LoomError::PayoutNotApproved);
    }

    let now = Clock::get()?.unix_timestamp;
    let price = load_sol_usd_prices(
        &ctx.accounts.price_update,
        &ctx.accounts.chainlink_feed,
        now,
        config.max_price_age_secs,
        config.max_confidence_bps,
    )?;

    // The 2x rule, valued at the lower of Pyth's conservative price and Chainlink.
    let collateral_value =
        math::lamports_to_stable(args.collateral_lamports, price.lowest(), price.expo(), STABLE_DECIMALS)?;
    require!(
        math::covers(collateral_value, args.principal, COLLATERAL_RATIO_BPS)?,
        LoomError::InsufficientCollateral
    );
    // A credit certificate held by this wallet unlocks the lower rate, up to its credit limit.
    // Credit levels: the optional certificate plus up to MAX_CREDIT_CERTIFICATES - 1 more passed as remaining
    // accounts, all held by this wallet and each from a different repaid loan.
    let borrower_key = ctx.accounts.borrower.key();
    let mut certificates: Vec<(Pubkey, u64)> = Vec::new();
    if let Some(cert) = &ctx.accounts.credit_certificate {
        require_keys_eq!(cert.holder, borrower_key, LoomError::NotCertificateHolder);
        certificates.push((cert.key(), cert.min_principal));
    }
    for info in ctx.remaining_accounts.iter().take(MAX_CREDIT_CERTIFICATES.saturating_sub(certificates.len())) {
        require_keys_eq!(*info.owner, crate::ID, LoomError::InvalidCertificate);
        let cert = CreditCertificate::try_deserialize(&mut &info.try_borrow_data()?[..])
            .map_err(|_| error!(LoomError::InvalidCertificate))?;
        require_keys_eq!(cert.holder, borrower_key, LoomError::NotCertificateHolder);
        require!(!certificates.iter().any(|(k, _)| k == info.key), LoomError::DuplicateCertificate);
        certificates.push((info.key(), cert.min_principal));
    }
    let (rate_bps, credit_certificate) = if certificates.is_empty() {
        (INTEREST_BPS, Pubkey::default())
    } else {
        let proven = certificates.iter().fold(0u64, |s, (_, p)| s.saturating_add(*p));
        require!(args.principal <= proven.saturating_mul(CREDIT_LIMIT_MULTIPLE), LoomError::AboveCreditLimit);
        let level = certificates.len().min(CREDIT_LEVEL_RATES_BPS.len());
        (CREDIT_LEVEL_RATES_BPS[level - 1], certificates[0].0)
    };
    let total_due = math::total_due(args.principal, rate_bps)?;

    // 1) Lock the SOL collateral in this loan's escrow PDA.
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.borrower.to_account_info(),
                to: ctx.accounts.escrow.to_account_info(),
            },
        ),
        args.collateral_lamports,
    )?;

    // 2) Pay the stablecoin to the recipient: from the pool vault (signed by the pool PDA), or from
    //    the treasury wallet (signed by the reserve PDA as the treasury's approved delegate).
    let mint_key = ctx.accounts.mint.key();
    if from_pool {
        let pool = ctx.accounts.pool.as_ref().unwrap();
        let seeds: &[&[u8]] = &[POOL_SEED, mint_key.as_ref(), &[pool.bump]];
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.pool_vault.as_ref().unwrap().to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.recipient_token.to_account_info(),
                    authority: pool.to_account_info(),
                },
                &[seeds],
            ),
            args.principal,
            ctx.accounts.mint.decimals,
        )?;
        let pool = ctx.accounts.pool.as_mut().unwrap();
        pool.cash -= args.principal;
        pool.principal_out = pool.principal_out.checked_add(args.principal).ok_or(LoomError::MathOverflow)?;
    } else {
        let seeds: &[&[u8]] = &[RESERVE_SEED, mint_key.as_ref(), &[ctx.accounts.reserve.bump]];
        transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.treasury_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.recipient_token.to_account_info(),
                    authority: ctx.accounts.reserve.to_account_info(),
                },
                &[seeds],
            ),
            args.principal,
            ctx.accounts.mint.decimals,
        )?;
    }

    // 3) Record everything on-chain.
    let config = &mut ctx.accounts.config;
    let loan_key = ctx.accounts.loan.key();
    let loan = &mut ctx.accounts.loan;
    loan.id = config.next_loan_id;
    loan.borrower = ctx.accounts.borrower.key();
    loan.nonce = args.nonce;
    loan.mint = mint_key;
    loan.principal = args.principal;
    loan.total_due = total_due;
    loan.repaid = 0;
    loan.collateral_lamports = args.collateral_lamports;
    loan.open_price = price.open_price() as i64;
    loan.open_price_expo = price.expo();
    loan.start_ts = now;
    loan.maturity_ts = now.checked_add(LOAN_TERM_SECS).ok_or(LoomError::MathOverflow)?;
    loan.closed_ts = 0;
    loan.liquidation_threshold_bps = config.liquidation_threshold_bps;
    loan.liquidation_penalty_bps = config.liquidation_penalty_bps;
    loan.status = LoanStatus::Active;
    loan.identity_commitment = args.identity_commitment;
    loan.credit_leaf = [0u8; 32];
    loan.credit_leaf_index = NO_LEAF;
    loan.bump = ctx.bumps.loan;
    loan.escrow_bump = ctx.bumps.escrow;
    loan.recipient = ctx.accounts.recipient.key();
    loan.rate_bps = rate_bps as u16;
    loan.principal_repaid = 0;
    loan.interest_accrued = 0;
    loan.accrued_ts = now;
    loan.credit_certificate = credit_certificate;
    loan.from_pool = from_pool;
    loan.opening_collateral_lamports = args.collateral_lamports;
    loan.credit_level = certificates.len() as u8;

    let escrow = &mut ctx.accounts.escrow;
    escrow.loan = loan_key;
    escrow.bump = ctx.bumps.escrow;

    let reserve = &mut ctx.accounts.reserve;
    reserve.total_disbursed = reserve.total_disbursed.checked_add(args.principal).ok_or(LoomError::MathOverflow)?;

    config.next_loan_id += 1;
    let s = &mut config.stats;
    s.loans_opened += 1;
    s.active_loans += 1;
    s.collateral_locked_lamports =
        s.collateral_locked_lamports.checked_add(args.collateral_lamports).ok_or(LoomError::MathOverflow)?;
    s.total_principal_issued = s.total_principal_issued.checked_add(args.principal).ok_or(LoomError::MathOverflow)?;
    s.outstanding_debt = s.outstanding_debt.checked_add(args.principal).ok_or(LoomError::MathOverflow)?;

    emit!(LoanOpened {
        loan: loan_key,
        id: loan.id,
        borrower: loan.borrower,
        recipient: loan.recipient,
        mint: mint_key,
        principal: args.principal,
        total_due,
        collateral_lamports: args.collateral_lamports,
        price: loan.open_price,
        price_expo: price.expo(),
        maturity_ts: loan.maturity_ts,
        rate_bps: loan.rate_bps,
        credit_certificate,
        from_pool,
    });
    Ok(())
}
