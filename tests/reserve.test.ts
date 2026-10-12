import { expect } from "chai";
import { Keypair } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { USD, createWorld, swapAccount, type World } from "./fixtures";

describe("reserves: init_reserve", () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld({ reserves: false });
  });

  it("creates the reserve, its vault, and the treasury's token account", async () => {
    const treasuryAta = getAssociatedTokenAddressSync(w.usdc, w.treasury.publicKey, true);
    expect(w.h.svm.getAccount(treasuryAta)).to.equal(null);
    w.h.send([await w.client.initReserve(w.admin.publicKey, w.usdc, w.treasury.publicKey)], [w.admin]);

    const r = w.reserve(w.usdc);
    expect(r.mint.equals(w.usdc)).to.be.true;
    expect(r.vault.equals(w.client.pda.vault(w.usdc))).to.be.true;
    expect(r.decimals).to.equal(6);
    expect([r.totalFunded, r.totalWithdrawn, r.totalDisbursed, r.totalRepaid]).to.deep.equal([0n, 0n, 0n, 0n]);
    expect(w.h.tokenAccountBalance(r.vault)).to.equal(0n);
    expect(w.h.svm.getAccount(treasuryAta)).to.not.equal(null);
  });

  it("works when the treasury token account already exists", async () => {
    w.fund(w.usdc, w.treasury.publicKey, USD(5));
    w.h.send([await w.client.initReserve(w.admin.publicKey, w.usdc, w.treasury.publicKey)], [w.admin]);
    expect(w.h.tokenBalance(w.usdc, w.treasury.publicKey)).to.equal(USD(5));
  });

  it("only the admin can create a reserve", async () => {
    w.fails([await w.client.initReserve(w.keeper.publicKey, w.usdc, w.treasury.publicKey)], [w.keeper], "ConstraintHasOne");
  });

  it("must name the configured treasury", async () => {
    w.fails([await w.client.initReserve(w.admin.publicKey, w.usdc, w.keeper.publicKey)], [w.admin], "ConstraintHasOne");
  });

  it("rejects mints that don't have 6 decimals", async () => {
    for (const decimals of [0, 2, 9]) {
      const mint = w.h.createMint(w.admin, decimals);
      w.fails([await w.client.initReserve(w.admin.publicKey, mint, w.treasury.publicKey)], [w.admin], "InvalidMintDecimals");
    }
  });

  it("one reserve per mint", async () => {
    w.h.send([await w.client.initReserve(w.admin.publicKey, w.usdc, w.treasury.publicKey)], [w.admin]);
    expect(w.h.sendExpectFail([await w.client.initReserve(w.admin.publicKey, w.usdc, w.treasury.publicKey)], [w.admin])).to.match(
      /already in use/,
    );
  });

  it("each mint gets its own reserve and vault", async () => {
    for (const m of [w.usdc, w.usdt]) w.h.send([await w.client.initReserve(w.admin.publicKey, m, w.treasury.publicKey)], [w.admin]);
    expect(w.reserve(w.usdc).vault.equals(w.reserve(w.usdt).vault)).to.be.false;
  });
});

describe("reserves: fund_reserve / withdraw_reserve", () => {
  let w: World;
  beforeEach(async () => {
    w = await createWorld();
  });

  it("funding moves admin tokens into the vault and records it", async () => {
    const adminBefore = w.h.tokenBalance(w.usdc, w.admin.publicKey);
    w.h.send([await w.client.fundReserve(w.admin.publicKey, w.usdc, USD(1_000))], [w.admin]);
    w.h.send([await w.client.fundReserve(w.admin.publicKey, w.usdc, USD(250))], [w.admin]);
    expect(w.h.tokenAccountBalance(w.client.pda.vault(w.usdc))).to.equal(USD(1_250));
    expect(adminBefore - w.h.tokenBalance(w.usdc, w.admin.publicKey)).to.equal(USD(1_250));
    expect(w.reserve(w.usdc).totalFunded).to.equal(USD(1_250));
    const ev = w.event("reserveFunded");
    expect(ev.amount.toString()).to.equal(USD(250).toString());
    expect(ev.vaultBalance.toString()).to.equal(USD(1_250).toString());
  });

  it("funding rejects zero, non-admins and someone else's token account", async () => {
    w.fails([await w.client.fundReserve(w.admin.publicKey, w.usdc, 0n)], [w.admin], "ZeroAmount");
    const keeperAta = w.fund(w.usdc, w.keeper.publicKey, USD(10));
    w.fails([await w.client.fundReserve(w.keeper.publicKey, w.usdc, USD(1), keeperAta)], [w.keeper], "ConstraintHasOne");
    // admin signs, but the source belongs to the keeper
    w.fails([await w.client.fundReserve(w.admin.publicKey, w.usdc, USD(1), keeperAta)], [w.admin], "ConstraintTokenOwner");
  });

  it("funding can't target another mint's vault", async () => {
    const ix = swapAccount(await w.client.fundReserve(w.admin.publicKey, w.usdc, USD(1)), w.client.pda.vault(w.usdc), w.client.pda.vault(w.usdt));
    w.fails([ix], [w.admin], "ConstraintHasOne");
  });

  it("the admin withdraws idle liquidity to any token account of the mint", async () => {
    w.h.send([await w.client.fundReserve(w.admin.publicKey, w.usdc, USD(1_000))], [w.admin]);
    const dest = w.fund(w.usdc, Keypair.generate().publicKey, 0n);
    w.h.send([await w.client.withdrawReserve(w.admin.publicKey, w.usdc, USD(400), dest)], [w.admin]);
    expect(w.h.tokenAccountBalance(dest)).to.equal(USD(400));
    expect(w.h.tokenAccountBalance(w.client.pda.vault(w.usdc))).to.equal(USD(600));
    expect(w.reserve(w.usdc).totalWithdrawn).to.equal(USD(400));
    const ev = w.event("reserveWithdrawn");
    expect(ev.destination.equals(dest)).to.be.true;
    expect(ev.vaultBalance.toString()).to.equal(USD(600).toString());
  });

  it("withdrawing rejects zero, more than the vault holds, non-admins and wrong-mint destinations", async () => {
    w.h.send([await w.client.fundReserve(w.admin.publicKey, w.usdc, USD(100))], [w.admin]);
    const dest = w.fund(w.usdc, w.admin.publicKey, 0n);
    w.fails([await w.client.withdrawReserve(w.admin.publicKey, w.usdc, 0n, dest)], [w.admin], "ZeroAmount");
    w.fails([await w.client.withdrawReserve(w.admin.publicKey, w.usdc, USD(100) + 1n, dest)], [w.admin], "InsufficientLiquidity");
    w.fails([await w.client.withdrawReserve(w.keeper.publicKey, w.usdc, USD(1), dest)], [w.keeper], "ConstraintHasOne");
    const usdtDest = w.fund(w.usdt, w.admin.publicKey, 0n);
    w.fails([await w.client.withdrawReserve(w.admin.publicKey, w.usdc, USD(1), usdtDest)], [w.admin], "ConstraintTokenMint");
    // the full balance can be withdrawn
    w.h.send([await w.client.withdrawReserve(w.admin.publicKey, w.usdc, USD(100), dest)], [w.admin]);
    expect(w.h.tokenAccountBalance(w.client.pda.vault(w.usdc))).to.equal(0n);
  });

  it("the legacy vault isn't touched by loans (they are paid from the treasury wallet)", async () => {
    w.h.send([await w.client.fundReserve(w.admin.publicKey, w.usdc, USD(1_000))], [w.admin]);
    await w.openLoan({ principal: USD(500) });
    expect(w.h.tokenAccountBalance(w.client.pda.vault(w.usdc))).to.equal(USD(1_000));
  });
});
