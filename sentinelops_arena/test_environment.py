"""Phase 2 verification tests for SentinelOpsArena environment."""

from sentinelops_arena.environment import SentinelOpsArena
from sentinelops_arena.models import SentinelAction, AgentRole


# -------------------------------------------------------------------
# Basic environment tests
# -------------------------------------------------------------------

def test_reset():
    env = SentinelOpsArena()
    obs = env.reset(seed=42)
    assert obs.done is False
    assert obs.current_agent == AgentRole.ATTACKER
    assert obs.tick == 0
    assert env.state.step_count == 0
    print("PASS: test_reset")


def test_turn_order():
    env = SentinelOpsArena()
    obs = env.reset(seed=42)
    assert obs.current_agent == AgentRole.ATTACKER

    obs = env.step(SentinelAction(agent=AgentRole.ATTACKER, action_type="pass"))
    assert obs.current_agent == AgentRole.WORKER

    obs = env.step(SentinelAction(
        agent=AgentRole.WORKER, action_type="respond", response_text="Hello"
    ))
    assert obs.current_agent == AgentRole.OVERSIGHT

    obs = env.step(SentinelAction(
        agent=AgentRole.OVERSIGHT, action_type="approve", flag=False
    ))
    assert obs.current_agent == AgentRole.ATTACKER
    assert env.tick == 1  # tick advanced after full rotation
    print("PASS: test_turn_order")


def test_full_episode():
    env = SentinelOpsArena()
    obs = env.reset(seed=42)
    steps = 0
    while not obs.done:
        agent = obs.current_agent
        if agent == AgentRole.ATTACKER:
            action = SentinelAction(agent=AgentRole.ATTACKER, action_type="pass")
        elif agent == AgentRole.WORKER:
            action = SentinelAction(
                agent=AgentRole.WORKER,
                action_type="respond",
                response_text="Done",
            )
        else:
            action = SentinelAction(
                agent=AgentRole.OVERSIGHT, action_type="approve", flag=False
            )
        obs = env.step(action)
        steps += 1

    assert env.tick == 30, f"Expected tick=30, got {env.tick}"
    assert steps == 90, f"Expected 90 steps, got {steps}"
    assert obs.done is True
    print("PASS: test_full_episode")


def test_wrong_turn_rejected():
    env = SentinelOpsArena()
    env.reset(seed=42)
    # Try worker action when it's attacker's turn
    obs = env.step(SentinelAction(
        agent=AgentRole.WORKER, action_type="respond", response_text="Wrong turn"
    ))
    assert obs.reward == -1.0
    print("PASS: test_wrong_turn_rejected")


# -------------------------------------------------------------------
# MCP routing tests
# -------------------------------------------------------------------

def test_mcp_list_tools():
    from openenv.core.env_server.mcp_types import ListToolsAction

    env = SentinelOpsArena()
    env.reset(seed=42)

    obs = env.step(ListToolsAction())
    tool_names = [t.name for t in obs.tools]
    assert "lookup_customer" in tool_names
    assert "launch_attack" in tool_names
    assert "issue_refund" in tool_names
    assert "flag_action" in tool_names
    # Reserved names must NOT appear
    assert "reset" not in tool_names
    assert "step" not in tool_names
    assert "state" not in tool_names
    assert "close" not in tool_names
    print(f"PASS: test_mcp_list_tools ({len(tool_names)} tools)")


def test_mcp_call_tool():
    from openenv.core.env_server.mcp_types import CallToolAction

    env = SentinelOpsArena()
    env.reset(seed=42)

    obs = env.step(CallToolAction(
        tool_name="lookup_customer", arguments={"customer_id": "C000"}
    ))
    assert obs.tool_name == "lookup_customer"
    assert obs.result is not None
    print("PASS: test_mcp_call_tool")


# -------------------------------------------------------------------
# Attack tests
# -------------------------------------------------------------------

def test_attacker_launch_attack():
    env = SentinelOpsArena()
    env.reset(seed=42)

    obs = env.step(SentinelAction(
        agent=AgentRole.ATTACKER,
        action_type="launch_attack",
        parameters={
            "attack_type": "schema_drift",
            "target_system": "crm",
            "old_field": "name",
            "new_field": "full_name",
        },
    ))
    # Attacker turn done, should be worker's turn now
    assert obs.current_agent == AgentRole.WORKER

    # Verify schema drift took effect
    schema = env.crm.get_schema()
    assert "full_name" in schema["fields"]
    assert "name" not in schema["fields"]
    print("PASS: test_attacker_launch_attack")


def test_worker_lookup_after_drift():
    env = SentinelOpsArena()
    env.reset(seed=42)

    # Attacker applies schema drift
    env.step(SentinelAction(
        agent=AgentRole.ATTACKER,
        action_type="launch_attack",
        parameters={
            "attack_type": "schema_drift",
            "target_system": "crm",
            "old_field": "name",
            "new_field": "full_name",
        },
    ))

    # Worker looks up customer
    obs = env.step(SentinelAction(
        agent=AgentRole.WORKER,
        action_type="lookup_customer",
        parameters={"customer_id": "C000"},
    ))
    # Should still succeed (field renamed but lookup_customer uses _apply_field_map)
    assert obs.last_action_result is not None
    print("PASS: test_worker_lookup_after_drift")


# -------------------------------------------------------------------
# State tests
# -------------------------------------------------------------------

def test_state_tracking():
    env = SentinelOpsArena()
    env.reset(seed=42)

    assert env.state.tick == 0
    assert env.state.step_count == 0
    assert env.state.tasks_total == 30

    # Do one full rotation
    env.step(SentinelAction(agent=AgentRole.ATTACKER, action_type="pass"))
    env.step(SentinelAction(
        agent=AgentRole.WORKER, action_type="respond", response_text="ok"
    ))
    env.step(SentinelAction(
        agent=AgentRole.OVERSIGHT, action_type="approve", flag=False
    ))

    assert env.state.tick == 1
    assert env.state.step_count == 3
    print("PASS: test_state_tracking")


# -------------------------------------------------------------------
# HTTP server test
# -------------------------------------------------------------------

def test_create_app():
    from openenv.core.env_server.http_server import create_app
    from sentinelops_arena.models import SentinelAction, SentinelObservation

    app = create_app(
        SentinelOpsArena,
        SentinelAction,
        SentinelObservation,
        env_name="sentinelops_arena",
    )
    assert app is not None
    print("PASS: test_create_app")


# -------------------------------------------------------------------
# Run all
# -------------------------------------------------------------------

if __name__ == "__main__":
    tests = [
        test_reset,
        test_turn_order,
        test_full_episode,
        test_wrong_turn_rejected,
        test_mcp_list_tools,
        test_mcp_call_tool,
        test_attacker_launch_attack,
        test_worker_lookup_after_drift,
        test_state_tracking,
        test_create_app,
    ]

    passed = 0
    failed = 0
    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            print(f"FAIL: {test.__name__}: {e}")
            failed += 1

    print(f"\n{'='*50}")
    print(f"Results: {passed}/{passed + failed} passed")
    if failed == 0:
        print("ALL PHASE 2 TESTS PASSED")
    else:
        print(f"{failed} test(s) FAILED")
