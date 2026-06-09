import * as anchor from "@coral-xyz/anchor";
import { assert } from "chai";

export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function expectError(
  action: () => Promise<unknown>,
  expectedCode: string
) {
  try {
    await action();
    assert.fail(`Expected ${expectedCode}`);
  } catch (err: any) {
    const code = err.error?.errorCode?.code;
    const message = `${err.error?.errorMessage ?? ""} ${err.toString()}`;
    assert.isTrue(
      code === expectedCode || message.includes(expectedCode),
      `Expected ${expectedCode}, got code=${code}, message=${message}`
    );
  }
}

export async function getTokenBalance(
  provider: anchor.AnchorProvider,
  account: anchor.web3.PublicKey
): Promise<bigint> {
  const balance = await provider.connection.getTokenAccountBalance(account);
  return BigInt(balance.value.amount);
}
