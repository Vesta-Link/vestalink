use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};
use crate::error::VestingError;

const VESTA_FAUCET_AMOUNT: u64 = 10_000_000_000;

#[derive(Accounts)]
pub struct RequestVesta<'info> {
    #[account(mut)]
    pub requester: Signer<'info>,

    #[account(mut)]
    pub vesta_mint: Account<'info, Mint>,

    #[account(
        mut,
        constraint = requester_token_account.owner == requester.key() @ VestingError::InvalidTokenOwner,
        constraint = requester_token_account.mint == vesta_mint.key() @ VestingError::InvalidTokenMint
    )]
    pub requester_token_account: Account<'info, TokenAccount>,

    /// CHECK: PDA mint authority used only as a token-program signer.
    #[account(seeds = [b"vesta_faucet"], bump)]
    pub faucet_authority: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

pub fn request_vesta_impl(ctx: Context<RequestVesta>) -> Result<()> {
    let bump = [ctx.bumps.faucet_authority];
    let seeds = &[b"vesta_faucet".as_ref(), &bump];
    let signer_seeds = &[&seeds[..]];

    let cpi_accounts = MintTo {
        mint: ctx.accounts.vesta_mint.to_account_info(),
        to: ctx.accounts.requester_token_account.to_account_info(),
        authority: ctx.accounts.faucet_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        cpi_accounts,
        signer_seeds,
    );
    token::mint_to(cpi_ctx, VESTA_FAUCET_AMOUNT)?;

    Ok(())
}
