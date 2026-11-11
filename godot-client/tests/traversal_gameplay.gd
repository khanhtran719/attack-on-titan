extends SceneTree
## Integration smoke starts in the same main scene and invokes its actual menu buttons.

var failed: bool = false


func _initialize() -> void:
	call_deferred("_run")


func _run() -> void:
	var result := change_scene_to_file("res://scenes/main.tscn")
	if result != OK:
		quit(1)
		return
	await scene_changed
	var game := current_scene
	_check(game.ui.screen == "menu", "main scene presents the menu")
	_press_button(game.ui.overlay, "Cadet Proving Grounds")
	await _ticks(10)
	_check(game.ui.screen == "play" and game.mission.actors.size() == 1, "training button loads one dummy and HUD")
	await _ticks(64)
	Input.action_press("move_forward")
	await _ticks(29)
	Input.action_release("move_forward")
	_check(game.mission.stage >= 1, "walking in Valkenburg advances the movement drill")

	Input.action_press("lock_target")
	await _ticks(2)
	Input.action_release("lock_target")
	_check(game.combat.has_target(), "the Titan can be target-locked in the actual scene")
	await _ticks(12)
	Input.action_press("grapple_left")
	Input.action_press("grapple_right")
	Input.action_press("boost")
	await _ticks(35)
	Input.action_release("grapple_left")
	Input.action_release("grapple_right")
	Input.action_release("boost")
	_check(game.player.total_grapples_fired >= 2, "the actual city/dummy provides both grapple anchors")
	_check(game.mission.stage == 4, "dual ODM, gas boost and target lock advance training to the final drill")

	var spears: int = game.player.thunder_spears
	Input.action_press("thunder_spear")
	await _ticks(2)
	Input.action_release("thunder_spear")
	_check(game.player.thunder_spears == spears - 1, "Thunder Spear fires from gameplay input")

	# A failure can be exercised without modifying the player's saved progression.
	game.player.damage(999.0)
	await _ticks(2)
	_check(game.ui.screen == "result" and game.mission.is_finished, "death leads to the mission result")
	game.ui.action.emit("restart", null)
	await _ticks(10)
	_check(game.ui.screen == "play" and game.player.health == 100.0 and game.mission.stage == 0,
		"restart resets player and training state")

	game.ui.action.emit("pause", null)
	var frozen: Vector3 = game.player.global_position
	await _ticks(12)
	_check(game.ui.screen == "pause" and game.player.global_position.is_equal_approx(frozen),
		"solo pause freezes traversal")
	game.ui.action.emit("resume", null)
	_check(game.ui.screen == "play" and game.player.active, "resume returns to play")

	if not failed:
		print("PASS main gameplay: menu, training, ODM drills, spear, death, restart and pause")
	quit(1 if failed else 0)


func _press_button(container: Node, title: String) -> void:
	for node in container.find_children("*", "Button", true, false):
		var button := node as Button
		if button.text == title:
			button.pressed.emit()
			return
	_check(false, "button exists: " + title)


func _ticks(count: int) -> void:
	for i in range(count):
		await physics_frame


func _check(condition: bool, description: String) -> void:
	if not condition:
		failed = true
		push_error("Gameplay smoke: " + description)
