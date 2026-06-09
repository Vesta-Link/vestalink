use crate::state::VestingType;

/// Calculates the unlocked token amount based on the vesting type.
/// Integer floor division ensures the unlocked amount never exceeds the true
/// proportional share.
pub fn calculate_unlocked(
    total_amount: u64,
    start_time: i64,
    end_time: i64,
    current_time: i64,
    vesting_type: &VestingType,
    cliff_time: i64,
    milestone_count: u8,
    milestones_reached: u8,
) -> u64 {
    match vesting_type {
        VestingType::Linear => {
            if current_time <= start_time {
                return 0;
            }
            if current_time >= end_time {
                return total_amount;
            }
            let elapsed = (current_time - start_time) as u128;
            let duration = (end_time - start_time) as u128;
            let total = total_amount as u128;
            ((total * elapsed) / duration) as u64
        }
        VestingType::Cliff => {
            if current_time <= cliff_time {
                return 0;
            }
            if current_time >= end_time {
                return total_amount;
            }
            let elapsed = (current_time - start_time) as u128;
            let duration = (end_time - start_time) as u128;
            let total = total_amount as u128;
            ((total * elapsed) / duration) as u64
        }
        VestingType::Milestone => {
            if milestone_count == 0 {
                return 0;
            }
            let total = total_amount as u128;
            let reached = milestones_reached as u128;
            let count = milestone_count as u128;
            ((total * reached) / count) as u64
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Helper: default parameters for linear vesting tests
    fn linear() -> VestingType {
        VestingType::Linear
    }
    fn cliff() -> VestingType {
        VestingType::Cliff
    }
    fn milestone() -> VestingType {
        VestingType::Milestone
    }

    // ── Linear vesting tests (existing, updated) ──

    #[test]
    fn unlocked_before_or_at_start_is_zero() {
        assert_eq!(
            calculate_unlocked(1_000, 100, 200, 99, &linear(), 100, 0, 0),
            0
        );
        assert_eq!(
            calculate_unlocked(1_000, 100, 200, 100, &linear(), 100, 0, 0),
            0
        );
    }

    #[test]
    fn unlocked_at_25_percent_is_quarter() {
        assert_eq!(
            calculate_unlocked(1_000, 100, 200, 125, &linear(), 100, 0, 0),
            250
        );
    }

    #[test]
    fn unlocked_at_50_percent_is_half() {
        assert_eq!(
            calculate_unlocked(1_000, 100, 200, 150, &linear(), 100, 0, 0),
            500
        );
    }

    #[test]
    fn unlocked_at_or_after_end_is_total() {
        assert_eq!(
            calculate_unlocked(1_000, 100, 200, 200, &linear(), 100, 0, 0),
            1_000
        );
        assert_eq!(
            calculate_unlocked(1_000, 100, 200, 201, &linear(), 100, 0, 0),
            1_000
        );
    }

    #[test]
    fn unlocked_uses_floor_division() {
        assert_eq!(calculate_unlocked(1_000, 0, 3, 1, &linear(), 0, 0, 0), 333);
        assert_eq!(calculate_unlocked(1_000, 0, 3, 2, &linear(), 0, 0, 0), 666);
    }

    // ── Property 8: Linear vesting unchanged ──
    // For any linear stream, extended calculate_unlocked produces the same
    // result as the original formula (total_amount * elapsed / duration).

    #[test]
    fn linear_vesting_unchanged() {
        let cases = vec![
            (1_000, 100, 200, 99),
            (1_000, 100, 200, 100),
            (1_000, 100, 200, 125),
            (1_000, 100, 200, 150),
            (1_000, 100, 200, 200),
            (1_000, 100, 200, 201),
            (1_000, 0, 3, 1),
            (1_000, 0, 3, 2),
        ];
        for (total, start, end, now) in cases {
            let expected = if now <= start {
                0u64
            } else if now >= end {
                total
            } else {
                let elapsed = (now - start) as u128;
                let duration = (end - start) as u128;
                ((total as u128 * elapsed) / duration) as u64
            };
            assert_eq!(
                calculate_unlocked(total, start, end, now, &linear(), start, 0, 0),
                expected,
                "linear mismatch for total={}, start={}, end={}, now={}",
                total,
                start,
                end,
                now
            );
        }
    }

    // ── Property 1: Cliff gates withdrawals ──
    // For any cliff stream, unlocked is zero before cliff_time.

    #[test]
    fn cliff_gates_withdrawals_before_cliff() {
        // Before cliff_time: nothing unlocked
        assert_eq!(
            calculate_unlocked(1_000, 100, 300, 150, &cliff(), 200, 0, 0),
            0
        );
        // At cliff_time exactly: still zero (<=)
        assert_eq!(
            calculate_unlocked(1_000, 100, 300, 200, &cliff(), 200, 0, 0),
            0
        );
        // Just before cliff
        assert_eq!(
            calculate_unlocked(1_000, 100, 300, 199, &cliff(), 200, 0, 0),
            0
        );
        // At start_time: zero
        assert_eq!(
            calculate_unlocked(1_000, 100, 300, 100, &cliff(), 200, 0, 0),
            0
        );
        // Before start_time: zero
        assert_eq!(
            calculate_unlocked(1_000, 100, 300, 50, &cliff(), 200, 0, 0),
            0
        );
    }

    // ── Property 2: Cliff falls through to linear after cliff_time ──
    // For any cliff stream after cliff_time, unlocked matches the linear formula.

    #[test]
    fn cliff_falls_through_to_linear_after_cliff() {
        // After cliff_time, linear formula applies from start_time to end_time
        // At t=250: elapsed=150, duration=200 => 1000*150/200 = 750
        assert_eq!(
            calculate_unlocked(1_000, 100, 300, 250, &cliff(), 200, 0, 0),
            750
        );
        // At t=201 (just past cliff): elapsed=101, duration=200 => 1000*101/200 = 505
        assert_eq!(
            calculate_unlocked(1_000, 100, 300, 201, &cliff(), 200, 0, 0),
            505
        );
        // At end_time: full amount
        assert_eq!(
            calculate_unlocked(1_000, 100, 300, 300, &cliff(), 200, 0, 0),
            1_000
        );
        // Past end_time: full amount
        assert_eq!(
            calculate_unlocked(1_000, 100, 300, 400, &cliff(), 200, 0, 0),
            1_000
        );
    }

    // ── Property 3: Cliff equal to start is linear ──
    // cliff_time == start_time produces same result as linear vesting.

    #[test]
    fn cliff_equal_to_start_is_linear() {
        let cases = vec![
            (1_000, 100, 200, 99),
            (1_000, 100, 200, 100),
            (1_000, 100, 200, 125),
            (1_000, 100, 200, 150),
            (1_000, 100, 200, 200),
            (1_000, 100, 200, 201),
        ];
        for (total, start, end, now) in cases {
            let linear_result = calculate_unlocked(total, start, end, now, &linear(), start, 0, 0);
            let cliff_result = calculate_unlocked(total, start, end, now, &cliff(), start, 0, 0);
            assert_eq!(
                linear_result, cliff_result,
                "cliff==start should match linear: total={}, start={}, end={}, now={}",
                total, start, end, now
            );
        }
    }

    // ── Property 4: Milestone unlock is proportional ──
    // For any milestone stream, unlocked equals total_amount * milestones_reached / milestone_count.

    #[test]
    fn milestone_unlock_is_proportional() {
        // 4 milestones, 2 reached => 1000 * 2 / 4 = 500
        assert_eq!(
            calculate_unlocked(1_000, 100, 300, 200, &milestone(), 100, 4, 2),
            500
        );
        // 3 milestones, 1 reached => 999 * 1 / 3 = 333
        assert_eq!(
            calculate_unlocked(999, 100, 300, 200, &milestone(), 100, 3, 1),
            333
        );
        // 5 milestones, 0 reached => 0
        assert_eq!(
            calculate_unlocked(1_000, 100, 300, 200, &milestone(), 100, 5, 0),
            0
        );
        // 5 milestones, all 5 reached => 1000
        assert_eq!(
            calculate_unlocked(1_000, 100, 300, 200, &milestone(), 100, 5, 5),
            1_000
        );
        // milestone_count == 0 => 0 (guard against division by zero)
        assert_eq!(
            calculate_unlocked(1_000, 100, 300, 200, &milestone(), 100, 0, 0),
            0
        );
        // Floor division: 1000 * 1 / 3 = 333
        assert_eq!(
            calculate_unlocked(1_000, 100, 300, 200, &milestone(), 100, 3, 1),
            333
        );
        // 1000 * 2 / 3 = 666
        assert_eq!(
            calculate_unlocked(1_000, 100, 300, 200, &milestone(), 100, 3, 2),
            666
        );
    }

    #[test]
    fn test_calculate_unlocked_coverage() {
        // Milestone count == 0 returns 0
        assert_eq!(calculate_unlocked(1000, 0, 100, 50, &VestingType::Milestone, 0, 0, 0), 0);
    }
}
