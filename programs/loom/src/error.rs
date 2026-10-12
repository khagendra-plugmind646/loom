use anchor_lang::prelude::*;

#[error_code]
pub enum LoomError {
    #[msg("Protocol is paused for new loans")]
    Paused,
    #[msg("Invalid protocol parameter")]
    InvalidParameter,
    #[msg("Stablecoin mint must have 6 decimals")]
    InvalidMintDecimals,
    #[msg("Principal is outside the allowed range")]
    PrincipalOutOfRange,
    #[msg("Collateral must be worth at least 200% of the principal")]
    InsufficientCollateral,
    #[msg("Not enough USDC/USDT available to pay out this loan")]
    InsufficientLiquidity,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Loan is not active")]
    LoanNotActive,
    #[msg("Loan term (12 months) has ended; it can no longer be repaid")]
    LoanMatured,
    #[msg("Loan is healthy (SOL above 60% of its opening price) and not past maturity; it cannot be settled")]
    NotLiquidatable,
    #[msg("Oracle account is not a Pyth PriceUpdateV2 account")]
    InvalidOracle,
    #[msg("Oracle price feed is not SOL/USD")]
    WrongPriceFeed,
    #[msg("Oracle price update is not fully verified")]
    OracleNotFullyVerified,
    #[msg("Oracle price is stale")]
    StalePrice,
    #[msg("Oracle price is invalid")]
    InvalidPrice,
    #[msg("Oracle confidence interval is too wide")]
    PriceTooUncertain,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Identity commitment is not a valid BN254 field element")]
    InvalidCommitment,
    #[msg("Poseidon hashing failed")]
    PoseidonFailed,
    #[msg("Credit tree is full")]
    CreditTreeFull,
    #[msg("Unknown credit tree root")]
    UnknownRoot,
    #[msg("Zero-knowledge proof verification failed")]
    InvalidProof,
    #[msg("The payout wallet has not approved enough USDC/USDT for this loan")]
    PayoutNotApproved,
    #[msg("The payout wallet cannot receive a loan")]
    InvalidRecipient,
    #[msg("Oracle account is not the Chainlink SOL/USD data feed")]
    InvalidChainlinkFeed,
    #[msg("Chainlink price is stale")]
    StaleChainlinkPrice,
    #[msg("This credit certificate belongs to another wallet")]
    NotCertificateHolder,
    #[msg("Loan is above this credit certificate's limit (2x the repaid loan it proves)")]
    AboveCreditLimit,
    #[msg("Lending pool account does not match this stablecoin")]
    InvalidPool,
    #[msg("This loan was funded by the lending pool; pass the pool accounts")]
    PoolAccountsRequired,
    #[msg("The lending pool doesn't have that much available right now (it is lent out)")]
    InsufficientPoolLiquidity,
    #[msg("The treasury must approve enough USDC/USDT to buy out this pool-funded loan before it can be settled")]
    PoolBackstopUnfunded,
    #[msg("Deposit is too small to mint a pool share")]
    DepositTooSmall,
    #[msg("You don't have that many pool shares")]
    InsufficientShares,
    #[msg("Repay a pool-funded loan in the stablecoin you borrowed")]
    RepayInLoanCoin,
    #[msg("The same credit certificate was passed twice")]
    DuplicateCertificate,
    #[msg("Account is not a Loom credit certificate")]
    InvalidCertificate,
}
