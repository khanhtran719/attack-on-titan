extends SceneTree

const Interface := preload("res://ui/interface.gd")

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var ui := Interface.new()
	root.add_child(ui)
	ui.play()
	var view := {
		"title": "TRAINING", "objective": "Dual ODM", "detail": "Aim at the wall",
		"elapsed": 0.0, "score": 0, "speed": 0.0, "network": "", "health": 100.0,
		"gas": 100.0, "blade": 100.0, "spare_blades": 6, "thunder_spears": 4,
		"left_ready": true, "right_ready": false, "left_latched": false, "right_latched": false,
		"hint": "", "debug": "",
	}
	var reticle := ui.hud.get_node_or_null("OdmReticle") as Control
	if not check(reticle != null and reticle.mouse_filter == Control.MOUSE_FILTER_IGNORE,
			"HUD uses a drawn, click-through ODM reticle"):
		return
	ui.update_hud(view)
	if not check(reticle.get("left_state") == 1 and reticle.get("right_state") == 0, "side readiness is independent"):
		return
	view.left_latched = true
	view.right_ready = true
	view.gas = 12.0
	view.hint = "Hold Shift to boost"
	ui.update_hud(view)
	if not check(reticle.get("left_state") == 2 and reticle.get("right_state") == 1, "latch takes precedence over readiness"):
		return
	if not check(ui.gear.text.begins_with("LOW GAS") and ui.hint.is_visible_in_tree(), "gas and contextual prompts are readable"):
		return
	view.gas = 100.0
	view.hint = ""
	ui.update_hud(view)
	if not check(not ui.gear.text.begins_with("LOW GAS") and not ui.hint.is_visible_in_tree(), "refill and empty prompts clear status"):
		return
	print("PASS ODM reticle states, low gas and contextual HUD")
	quit()

func check(ok: bool, message: String) -> bool:
	if not ok:
		push_error(message)
		quit(1)
	return ok
