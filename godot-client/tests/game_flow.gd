extends SceneTree

const Main := preload("res://scenes/main.tscn")

func _initialize() -> void:
	call_deferred("run")

func run() -> void:
	var game := Main.instantiate()
	root.add_child(game)
	await process_frame
	if not check(game.ui.screen == "menu" and not game.player.active, "main menu and input state"):
		return
	game.ui.action.emit("training", null)
	await ticks(80)
	Input.action_press("move_forward")
	await ticks(28)
	Input.action_release("move_forward")
	if not check(game.mission.stage == 1 and game.player.position.z < 22.0, "training stage advances via movement"):
		return
	Input.action_press("grapple_left")
	Input.action_press("grapple_right")
	await ticks(24)
	if not check(game.player.total_grapples_fired >= 2 and game.player.odm.left_hook.active and game.player.odm.right_hook.active, "dual hooks attach to real Valkenburg tower"):
		return
	Input.action_press("boost")
	await ticks(37)
	Input.action_release("boost")
	Input.action_release("grapple_left")
	Input.action_release("grapple_right")
	await ticks(3)
	if not check(game.mission.stage >= 3 and game.player.gas < 100.0, "gas consumption advances training"):
		return
	game.ui.action.emit("pause", null)
	var paused := game.player.position as Vector3
	await ticks(6)
	if not check(game.ui.screen == "pause" and game.player.position.is_equal_approx(paused), "offline pause freezes motion"):
		return
	game.ui.action.emit("restart", null)
	await ticks(2)
	if not check(game.mission.stage == 0 and game.player.gas > 99.0 and game.mission.actors.size() == 1, "restart clears mode state and resources"):
		return
	game.ui.action.emit("menu", null)
	game.ui.action.emit("hunt", null)
	await ticks(4)
	if not check(game.mission.actors.size() == 3 and game.mission.wave == 1, "hunt starts with source wave roster"):
		return
	var first: TitanActor = game.mission.actors[0]
	first.dummy = true
	first.position = Vector3(0, 0, 14)
	first.rotation.y = 0.0
	await ticks(2)
	var nape := first.zone_position("Nape")
	game.player.global_position = nape - Vector3(0, 1.15, 2.7)
	game.player.velocity = Vector3(0, 0, 12)
	game.player.yaw = 0.0
	Input.action_press("attack")
	await ticks(2)
	Input.action_release("attack")
	await ticks(26)
	if not check(first.is_dead() and game.mission.kills == 1 and game.player.blade_durability < 100.0,
			"F executes a rear Nape hit, consumes blade and awards kill"):
		return
	for actor in game.mission.actors.duplicate():
		if actor.is_dead():
			continue
		var outcome: Dictionary = actor.apply_damage("Nape", 9999.0)
		outcome.multiplier = 2.0
		game.mission.register_hit(actor, outcome, 1, game.city.spawn_points)
	if not check(game.mission.wave == 2 and game.mission.kills == 3 and game.mission.actors.size() == 7, "hunt promotes to four Titan second wave"):
		return
	game.player.damage(150.0)
	await ticks(3)
	if not check(game.ui.screen == "result" and game.mission.is_finished, "death opens mission result"):
		return
	game.ui.action.emit("menu", null)
	game.coop.snapshot_received.emit({"phase": "lobby", "roomName": "Departed room", "roomCode": "AAAA", "players": {}})
	if not check(game.ui.screen == "menu" and game.mode.is_empty(), "late room snapshot cannot reopen the departed room"):
		return
	print("PASS scene entry, training, ODM, pause/restart, Nape strike, hunt waves, death and late room snapshot")
	quit()

func ticks(count: int) -> void:
	for index in count:
		await physics_frame

func check(ok: bool, feature: String) -> bool:
	if not ok:
		push_error("Game flow failed: %s" % feature)
		quit(1)
	return ok
