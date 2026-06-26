use anchor_lang::prelude::*;
use crate::state::GlobalConfig;
use crate::error::VestingError;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init_if_needed,
        payer = admin,
        space = GlobalConfig::SIZE,
        seeds = [b"global_config"],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: We check the constraint below.
    #[account(
        constraint = program_data.upgrade_authority_address == Some(admin.key())
            @ VestingError::Unauthorized
    )]
    pub program_data: Account<'info, ProgramData>,

    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, crate::program::Vestalink>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_config_impl(ctx: Context<InitializeConfig>) -> Result<()> {
    let global_config = &mut ctx.accounts.global_config;
    global_config.admin = ctx.accounts.admin.key();
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateAdmin<'info> {
    #[account(
        mut,
        seeds = [b"global_config"],
        bump,
        has_one = admin @ VestingError::Unauthorized
    )]
    pub global_config: Account<'info, GlobalConfig>,

    pub admin: Signer<'info>,
}

pub fn update_admin_impl(ctx: Context<UpdateAdmin>, new_admin: Pubkey) -> Result<()> {
    let global_config = &mut ctx.accounts.global_config;
    global_config.admin = new_admin;
    Ok(())
}
