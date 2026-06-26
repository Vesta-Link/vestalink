import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMint,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Vestalink } from "../target/types/vestalink";
import { nowSeconds } from "./utils";

const BPF_LOADER_UPGRADEABLE = new anchor.web3.PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111"
);

export class VestalinkFixture {
  provider: anchor.AnchorProvider;
  program: Program<Vestalink>;
  wallet: anchor.Wallet;

  mint!: anchor.web3.PublicKey;
  otherMint!: anchor.web3.PublicKey;
  faucetMint!: anchor.web3.PublicKey;
  funderTokenAccount!: anchor.web3.PublicKey;
  recipient!: anchor.web3.Keypair;
  globalConfigPda!: anchor.web3.PublicKey;

  constructor() {
    this.provider = anchor.AnchorProvider.env();
    anchor.setProvider(this.provider);
    this.program = anchor.workspace.vestalink as Program<Vestalink>;
    this.wallet = this.provider.wallet as anchor.Wallet;
  }

  async setup() {
    this.mint = await createMint(
      this.provider.connection,
      this.wallet.payer,
      this.wallet.payer.publicKey,
      null,
      6
    );
    this.otherMint = await createMint(
      this.provider.connection,
      this.wallet.payer,
      this.wallet.payer.publicKey,
      null,
      6
    );
    const [faucetAuthority] = this.deriveFaucetPda();
    this.faucetMint = await createMint(
      this.provider.connection,
      this.wallet.payer,
      faucetAuthority,
      null,
      6
    );
    this.funderTokenAccount = (
      await getOrCreateAssociatedTokenAccount(
        this.provider.connection,
        this.wallet.payer,
        this.mint,
        this.wallet.payer.publicKey
      )
    ).address;
    await mintTo(
      this.provider.connection,
      this.wallet.payer,
      this.mint,
      this.funderTokenAccount,
      this.wallet.payer.publicKey,
      100_000_000_000
    );
    this.recipient = anchor.web3.Keypair.generate();

    this.globalConfigPda = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("global_config")],
      this.program.programId
    )[0];

    try {
      await this.program.account.globalConfig.fetch(this.globalConfigPda);
    } catch (e) {
      console.log("Global config not initialized, initializing...", (e as Error).message);
      const [programDataAddress] = anchor.web3.PublicKey.findProgramAddressSync(
        [this.program.programId.toBuffer()],
        BPF_LOADER_UPGRADEABLE
      );
      
      const accInfo = await this.provider.connection.getAccountInfo(programDataAddress);
      if (accInfo) {
        const offset = 13;
        const upgradeAuth = new anchor.web3.PublicKey(accInfo.data.subarray(offset, offset + 32));
        console.log("Wallet:", this.wallet.publicKey.toBase58());
        console.log("Upgrade Auth:", upgradeAuth.toBase58());
      }
      
      await this.program.methods
        .initializeConfig()
        .accountsPartial({
          globalConfig: this.globalConfigPda,
          admin: this.wallet.publicKey,
          programData: programDataAddress,
          program: this.program.programId,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    }
  }

  derivePda(
    funder: anchor.web3.PublicKey,
    streamRecipient: anchor.web3.PublicKey,
    nonce: anchor.BN
  ) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("vesting"),
        funder.toBuffer(),
        streamRecipient.toBuffer(),
        nonce.toArrayLike(Buffer, "le", 8),
      ],
      this.program.programId
    );
  }

  deriveFaucetPda() {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("vesta_faucet")],
      this.program.programId
    );
  }

  async createStream(
    params: {
      totalAmount?: anchor.BN;
      startTime?: anchor.BN;
      endTime?: anchor.BN;
      nonce?: anchor.BN;
      streamRecipient?: anchor.web3.Keypair;
      vestingType?: any;
      cliffTime?: anchor.BN;
      milestoneCount?: number;
      method?: "createStream" | "createVestingSchedule";
      funderTokenAcct?: anchor.web3.PublicKey;
      vaultTokenAccount?: anchor.web3.PublicKey;
    } = {}
  ) {
    const streamRecipient = params.streamRecipient ?? this.recipient;
    const nonce = params.nonce ?? new anchor.BN(Date.now());
    const totalAmount = params.totalAmount ?? new anchor.BN(1_000_000);
    const startTime = params.startTime ?? new anchor.BN(nowSeconds());
    const endTime =
      params.endTime ?? new anchor.BN(nowSeconds() + 365 * 24 * 60 * 60);
    const vestingType = params.vestingType ?? { linear: {} };
    const cliffTime = params.cliffTime ?? startTime;
    const milestoneCount = params.milestoneCount ?? 0;
    const [vestingStatePda, vestingStateBump] = this.derivePda(
      this.wallet.payer.publicKey,
      streamRecipient.publicKey,
      nonce
    );
    const vestingTokenAccount =
      params.vaultTokenAccount ??
      getAssociatedTokenAddressSync(this.mint, vestingStatePda, true);
    const recipientTokenAccount = getAssociatedTokenAddressSync(
      this.mint,
      streamRecipient.publicKey
    );

    const preInstructions = [];
    if (!params.vaultTokenAccount) {
      preInstructions.push(
        createAssociatedTokenAccountIdempotentInstruction(
          this.wallet.payer.publicKey,
          vestingTokenAccount,
          vestingStatePda,
          this.mint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }
    preInstructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        this.wallet.payer.publicKey,
        recipientTokenAccount,
        streamRecipient.publicKey,
        this.mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );

    const args = {
      totalAmount,
      vestingType,
      startTime,
      endTime,
      cliffTime,
      milestoneCount,
      nonce,
    };
    
    let globalConfigInfo = null;
    try {
      globalConfigInfo = await this.program.account.globalConfig.fetch(this.globalConfigPda);
    } catch (e) {
      console.log("Global config not initialized yet.", (e as Error).message);
    }
    const adminAddress = globalConfigInfo ? globalConfigInfo.admin : this.provider.wallet.publicKey;

    const builder =
      params.method === "createVestingSchedule"
        ? this.program.methods.createVestingSchedule(args)
        : this.program.methods.createStream(args);

    await builder
      .accountsPartial({
        vestingState: vestingStatePda,
        funder: this.wallet.payer.publicKey,
        recipient: streamRecipient.publicKey,
        funderTokenAccount: params.funderTokenAcct ?? this.funderTokenAccount,
        mint: this.mint,
        vestingTokenAccount,
        globalConfig: this.globalConfigPda,
        adminAddress: adminAddress,
        adminTokenAccount: getAssociatedTokenAddressSync(this.mint, adminAddress, true),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .preInstructions(preInstructions)
      .rpc();

    return {
      vestingStatePda,
      vestingStateBump,
      vestingTokenAccount,
      recipientTokenAccount,
      streamRecipient,
      nonce,
      totalAmount,
      startTime,
      endTime,
    };
  }

  async withdraw(
    stream: Awaited<ReturnType<typeof this.createStream>>,
    params: {
      signer?: anchor.web3.Keypair;
      recipientTokenAccount?: anchor.web3.PublicKey;
      method?: "withdraw" | "claim" | "claimTokens";
    } = {}
  ) {
    const signer = params.signer ?? stream.streamRecipient;
    let builder;
    if (params.method === "claim") {
      builder = this.program.methods.claim();
    } else if (params.method === "claimTokens") {
      builder = this.program.methods.claimTokens();
    } else {
      builder = this.program.methods.withdraw();
    }

    return builder
      .accountsPartial({
        vestingState: stream.vestingStatePda,
        recipient: signer.publicKey,
        recipientTokenAccount:
          params.recipientTokenAccount ?? stream.recipientTokenAccount,
        vestingTokenAccount: stream.vestingTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([signer])
      .rpc();
  }

  async revokeVesting(
    stream: Awaited<ReturnType<typeof this.createStream>>,
    params: {
      method?: "revokeVesting" | "cancelVesting";
      authorityRevoker?: anchor.web3.PublicKey;
      treasuryReturnAddress?: anchor.web3.PublicKey;
    } = {}
  ) {
    const builder =
      params.method === "cancelVesting"
        ? this.program.methods.cancelVesting()
        : this.program.methods.revokeVesting();

    return builder
      .accountsPartial({
        vestingState: stream.vestingStatePda,
        authorityRevoker: params.authorityRevoker ?? this.wallet.payer.publicKey,
        treasuryReturnAddress:
          params.treasuryReturnAddress ?? this.funderTokenAccount,
        vestingTokenAccount: stream.vestingTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
  }

  async cancelStream(
    stream: Awaited<ReturnType<typeof this.createStream>>,
    params: {
      authorityRevoker?: anchor.web3.PublicKey;
      treasuryReturnAddress?: anchor.web3.PublicKey;
      signer?: anchor.web3.Keypair;
    } = {}
  ) {
    const builder = this.program.methods.cancelStream().accountsPartial({
      vestingState: stream.vestingStatePda,
      authorityRevoker: params.authorityRevoker ?? this.wallet.payer.publicKey,
      treasuryReturnAddress: params.treasuryReturnAddress ?? this.funderTokenAccount,
      vestingTokenAccount: stream.vestingTokenAccount,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
    
    if (params.signer) {
      builder.signers([params.signer]);
    }
    return builder.rpc();
  }

  async unlockMilestone(
    stream: Awaited<ReturnType<typeof this.createStream>>,
    params: { authorityMilestone?: anchor.web3.PublicKey } = {}
  ) {
    return this.program.methods
      .unlockMilestone()
      .accountsPartial({
        vestingState: stream.vestingStatePda,
        authorityMilestone: params.authorityMilestone ?? this.wallet.payer.publicKey,
      })
      .rpc();
  }
}
