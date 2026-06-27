use anchor_lang::prelude::*;

pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

pub use error::*;
pub use instructions::*;
pub use state::*;
pub use utils::*;

declare_id!("8q5LLVTGNUS16AV4xj6KPLet1M7y4xpa8XjxV7cHH98r");

#[program]
pub mod vestalink {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        initialize_config_impl(ctx)
    }

    pub fn update_admin(ctx: Context<UpdateAdmin>, new_admin: Pubkey) -> Result<()> {
        update_admin_impl(ctx, new_admin)
    }

    pub fn create_stream(
        ctx: Context<CreateVestingSchedule>,
        params: CreateVestingParams,
    ) -> Result<()> {
        create_stream_impl(ctx, params)
    }

    pub fn unlock_milestone(ctx: Context<UnlockMilestone>) -> Result<()> {
        unlock_milestone_impl(ctx)
    }

    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        withdraw_impl(ctx)
    }

    pub fn revoke_vesting(ctx: Context<RevokeVesting>) -> Result<()> {
        revoke_vesting_impl(ctx)
    }

    pub fn cancel_stream(ctx: Context<RevokeVesting>) -> Result<()> {
        cancel_stream_impl(ctx)
    }

    pub fn request_vesta(ctx: Context<RequestVesta>) -> Result<()> {
        request_vesta_impl(ctx)
    }
}
