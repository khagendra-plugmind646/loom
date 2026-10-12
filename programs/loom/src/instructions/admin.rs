use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::LoomError;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeParams {
    pub treasury: Pubkey,
    pub liquidation_threshold_bps: u16,
    pub liquidation_penalty_bps: u16,
    pub max_price_age_secs: u32,
    pub max_confidence_bps: u16,
    pub min_principal: u64,
    pub max_principal: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Default)]
pub struct UpdateConfigParams {
    pub new_admin: Option<Pubkey>,
    pub treasury: Option<Pubkey>,
    pub liquidation_threshold_bps: Option<u16>,
    pub liquidation_penalty_bps: Option<u16>,
    pub max_price_age_secs: Option<u32>,
    pub max_confidence_bps: Option<u16>,
    pub min_principal: Option<u64>,
    pub max_principal: Option<u64>,
    pub paused: Option<bool>,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(init, payer = admin, space = 8 + CreditTree::INIT_SPACE, seeds = [CREDIT_TREE_SEED], bump)]
    pub credit_tree: Box<Account<'info, CreditTree>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin)]
    pub config: Box<Account<'info, Config>>,
}

fn validate(config: &Config) -> Result<()> {
    // Liquidation must trigger strictly between 100% and the 200% origination ratio.
    require!(
        (config.liquidation_threshold_bps as u64) > BPS
            && (config.liquidation_threshold_bps as u64) < COLLATERAL_RATIO_BPS,
        LoomError::InvalidParameter
    );
    require!(config.liquidation_penalty_bps <= 2_000, LoomError::InvalidParameter);
    require!(config.max_price_age_secs > 0 && config.max_price_age_secs <= 3_600, LoomError::InvalidParameter);
    require!(config.max_confidence_bps > 0 && config.max_confidence_bps <= 1_000, LoomError::InvalidParameter);
    require!(config.min_principal > 0 && config.min_principal <= config.max_principal, LoomError::InvalidParameter);
    Ok(())
}

pub fn process_initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.treasury = params.treasury;
    config.liquidation_threshold_bps = params.liquidation_threshold_bps;
    config.liquidation_penalty_bps = params.liquidation_penalty_bps;
    config.max_price_age_secs = params.max_price_age_secs;
    config.max_confidence_bps = params.max_confidence_bps;
    config.min_principal = params.min_principal;
    config.max_principal = params.max_principal;
    config.paused = false;
    config.next_loan_id = 0;
    config.stats = ProtocolStats::default();
    config.bump = ctx.bumps.config;
    validate(config)?;

    ctx.accounts.credit_tree.initialize(ctx.bumps.credit_tree)
}

pub fn process_update_config(ctx: Context<UpdateConfig>, params: UpdateConfigParams) -> Result<()> {
    let config = &mut ctx.accounts.config;
    if let Some(v) = params.new_admin {
        config.admin = v;
    }
    if let Some(v) = params.treasury {
        config.treasury = v;
    }
    if let Some(v) = params.liquidation_threshold_bps {
        config.liquidation_threshold_bps = v;
    }
    if let Some(v) = params.liquidation_penalty_bps {
        config.liquidation_penalty_bps = v;
    }
    if let Some(v) = params.max_price_age_secs {
        config.max_price_age_secs = v;
    }
    if let Some(v) = params.max_confidence_bps {
        config.max_confidence_bps = v;
    }
    if let Some(v) = params.min_principal {
        config.min_principal = v;
    }
    if let Some(v) = params.max_principal {
        config.max_principal = v;
    }
    if let Some(v) = params.paused {
        config.paused = v;
    }
    validate(config)
}
