extends Node3D

const City := preload("res://world/city.gd")
const Player := preload("res://player/player.gd")
const Combat := preload("res://combat/combat.gd")
const Mission := preload("res://missions/mission.gd")
const Actor := preload("res://combat/titan.gd")
const Interface := preload("res://ui/interface.gd")
const Save := preload("res://ui/save_data.gd")
const Network := preload("res://multiplayer/coop_client.gd")
const RemoteSquad := preload("res://multiplayer/remote_squad.gd")
const DebugView := preload("res://world/debug_view.gd")
const Feedback := preload("res://combat/effects.gd")
const Data := preload("res://resources/game_data.gd")
const SPAWN := Vector3(0, 0.2, 24)
const QUICK_CHAT := ["target_nape", "cripple_legs", "need_help", "resupplying"]

var city := City.new()
var player := Player.new()
var combat := Combat.new()
var mission := Mission.new()
var ui := Interface.new()
var save := Save.new()
var coop := Network.new()
var feedback := Feedback.new()
var remote_squad := RemoteSquad.new()
var mode := ""
var settings_back := "menu"
var _tactical := false
var _paused := false
var _mine: Dictionary = {}
var _match_snapshot: Dictionary = {}
var _snapshot_tick := -1
var _accept_room_snapshots := false
var _grabber: Actor
var _grip := Marker3D.new()
var _projectiles: Dictionary = {}
var _gas_trail_time := 0.0
var _last_ping := ""
var _hud_timer := 0.0
var _debug_node := DebugView.new()
var _debug_time := 0.0

func _ready() -> void:
	process_physics_priority = 5
	save.restore()
	for node in [city, player, mission, combat, feedback, coop, ui, _grip]:
		add_child(node)
	add_child(remote_squad)
	remote_squad.exhaust_emitted.connect(feedback.gas_puff)
	add_child(_debug_node)
	combat.projectile_visual = feedback.make_projectile
	mission.spawned.connect(_bind_titan)
	mission.finished.connect(_on_result)
	combat.hit.connect(_on_hit)
	combat.effect.connect(_feedback_effect)
	ui.action.connect(_action)
	coop.connection_changed.connect(_connection_changed)
	coop.rooms_changed.connect(ui.update_rooms)
	coop.snapshot_received.connect(_on_snapshot)
	coop.combat_event_received.connect(_on_network_combat)
	coop.room_error_received.connect(func(error: Dictionary) -> void: ui.status(error.get("message", "Room error")))
	player.physics_sampled.connect(_send_input)
	player.died.connect(func() -> void:
		if mode in ["training", "hunt"]:
			mission.end(false))
	player.hook_fired.connect(func(side: String) -> void: feedback.play_cue("hook_%s" % side))
	player.hook_latched.connect(func(point: Vector3) -> void: feedback.play_cue("hook_latch", point))
	player.boost_changed.connect(func(boosting: bool) -> void:
		if boosting:
			feedback.play_cue("gas"))
	player.perfect_dodged.connect(func() -> void:
		if mode != "coop":
			mission.score += 250
			ui.announce("PERFECT DODGE   +250"))
	player.landed.connect(func(speed: float) -> void:
		if speed > 14.0:
			player.camera.add_shake(0.14, 0.14))
	player.grab_released.connect(_on_grab_released)
	player.respawn(SPAWN)
	_apply_settings()
	_show_menu()

func _unhandled_input(event: InputEvent) -> void:
	if not event.is_action_pressed("pause") or event.is_echo():
		return
	if ui.screen == "play":
		_pause()
	elif ui.screen == "pause":
		_resume(false)
	elif ui.screen == "settings":
		_settings_back()
	get_viewport().set_input_as_handled()

func _physics_process(delta: float) -> void:
	if mode.is_empty() or mission.is_finished:
		return
	if _paused and mode != "coop":
		return
	if mode != "coop" and combat.hit_stop > 0.0:
		combat.hit_stop = maxf(0.0, combat.hit_stop - delta)
		if combat.hit_stop == 0.0:
			player.active = true
			mission.process_mode = Node.PROCESS_MODE_INHERIT
		return
	_update_remote_projectiles(delta)
	var player_position := player.global_position
	var loud := player.is_boosting or player.odm.any_active()
	var rings := city.collect_rings(player_position) if mode == "training" else 0
	mission.step(delta, player_position, player.velocity, loud, player.grounded,
		player.total_grapples_fired, player.total_boost_time, combat.has_target(), rings, city.patrol_points)
	if is_instance_valid(_grabber):
		_grip.global_position = _grabber.grip_position()
	var controls := not _paused and not player.is_dead() and not player.downed and not player.is_grabbed()
	if controls:
		_gameplay_actions()
	_gas_trail_time -= delta
	if loud and _gas_trail_time <= 0.0:
		_gas_trail_time = 0.025 if player.is_boosting else 0.065
		feedback.gas_puff(player.thruster_position(), player.velocity)
	var blades := player.blade_segments() if controls else []
	var segments: Array[PackedVector3Array] = []
	segments.assign(blades)
	combat.step(delta, player_position, player.velocity, player.blade_durability, segments, mission.actors, mode != "coop")
	if combat.has_target():
		player.locked_target = combat.locked.zones[combat.zone].marker
	else:
		player.locked_target = null

func _process(delta: float) -> void:
	if mode.is_empty() or not ui.hud.visible:
		return
	_hud_timer -= delta
	_debug_time -= delta
	if _hud_timer <= 0.0:
		_hud_timer = 1.0 / 20.0
		_update_hud()
	if _debug_time <= 0.0:
		_debug_time = 0.10
		_debug_node.refresh(save.settings.debug, city, player, mission.actors)
	if combat.has_target():
		var zone: Dictionary = combat.locked.zones[combat.zone]
		var integrity := "SEVERED" if zone.disabled > 0 else "%s%%" % roundi(float(zone.hp) * 100.0 / float(zone.max_hp))
		var text := "%s  ·  %s  ·  %s m" % [combat.zone.to_upper(), integrity,
			roundi(player.global_position.distance_to(combat.target_position()))]
		ui.show_marker(player.camera, combat.target_position(), text)
	else:
		ui.show_marker(player.camera, Vector3.ZERO, "")
	ui.update_pings(player.camera, _match_snapshot.get("pings", []), player.global_position)

func _gameplay_actions() -> void:
	var tactical_held := Input.is_action_pressed("tactical_overlay")
	if tactical_held != _tactical:
		_tactical = tactical_held
		ui.set_tactical(_tactical)
	if _tactical:
		return
	if Input.is_action_just_pressed("lock_target"):
		combat.cycle_target(player.global_position, player.aim_direction(), mission.actors)
	if Input.is_action_just_pressed("cycle_zone_next"):
		combat.cycle_zone(1)
	if Input.is_action_just_pressed("cycle_zone_prev"):
		combat.cycle_zone(-1)
	if Input.is_action_just_pressed("resupply") and mode != "coop":
		if city.nearby_depot(player.global_position):
			player.resupply()
			feedback.play_cue("resupply")
			ui.announce("DEPOT RESUPPLY")
		elif player.reload_blades():
			feedback.play_cue("resupply")
			ui.announce("BLADES REPLACED")
	if Input.is_action_just_pressed("attack"):
		_attack()
	if Input.is_action_just_pressed("thunder_spear"):
		_fire_spear()
	if mode == "coop":
		_ping_actions()

func _attack() -> void:
	var heavy := player.is_boosting or (not player.grounded and player.velocity.length() > 22.0)
	var started := combat.start_attack(heavy, player.global_position, player.velocity, mission.actors)
	if started.is_empty():
		return
	player.play_action(&"HeavyAttack" if heavy else &"LightAttack", started.duration)
	player.velocity += Vector3(started.lunge)
	feedback.play_cue("heavy_slash" if heavy else "light_slash")
	feedback.slash(player.global_position, player.yaw, heavy)
	if mode == "coop":
		_send_attack("blade", heavy)

func _fire_spear() -> void:
	if player.thunder_spears <= 0:
		ui.announce("NO THUNDER SPEARS   /   RESUPPLY AT A DEPOT")
		return
	var aim := player.aim_direction()
	var launch := player.global_position + Vector3.UP * 1.4 + aim * 0.5
	if not combat.launch_spear(launch, aim, mission.actors, mode != "coop"):
		return
	if mode == "coop":
		_send_attack("thunder_spear", false)
	else:
		feedback.play_cue("spear_launch")
		player.thunder_spears -= 1

func _bind_titan(actor: Actor) -> void:
	actor.cue.connect(feedback.play_cue)
	actor.strike.connect(_on_titan_strike)

func _on_titan_strike(actor: Actor, grab: bool, point: Vector3, radius: float, damage: float) -> void:
	var chest := player.global_position + Vector3.UP * 0.9
	if chest.distance_to(point) > radius or player.is_dead() or player.is_grabbed():
		return
	var wall := get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(point, chest, 1))
	if not wall.is_empty():
		return
	if grab:
		_grip.global_position = actor.grip_position()
		if player.capture_by_titan(_grip, damage, actor.forward()):
			_grabber = actor
	else:
		var away := (player.global_position - actor.global_position).normalized()
		if player.damage(damage, away):
			feedback.play_cue("impact", chest)
			player.camera.add_shake(0.35, 0.24)

func _on_grab_released(escaped: bool) -> void:
	if escaped and is_instance_valid(_grabber):
		_grabber.apply_damage("RightArm", 999.0)
		_grabber.stagger(4.0)
		feedback.play_cue("grab_escape")
		ui.announce("GRAB BROKEN")
	_grabber = null

func _on_hit(actor: Actor, zone: String, outcome: Dictionary) -> void:
	if not outcome.spear:
		var wear := 22.0 if outcome.glance else 14.0
		player.blade_durability = maxf(0.0, player.blade_durability - wear)
	var style := "glance" if outcome.glance else ("critical" if outcome.critical else "impact")
	_feedback_effect(style, outcome.point)
	player.camera.add_shake(0.36 if outcome.critical else 0.2, 0.22)
	if not outcome.spear and not outcome.glance:
		player.active = false
		mission.process_mode = Node.PROCESS_MODE_DISABLED
	if actor == _grabber and (outcome.killed or outcome.broken or outcome.spear):
		player.release_grab()
	if outcome.glance:
		ui.announce("GLANCED OFF   /   ATTACK THE NAPE FROM BEHIND")
	elif outcome.killed:
		feedback.burst(outcome.point, "steam")
		ui.announce("NAPE EXECUTION   %s DAMAGE" % outcome.damage)
	elif outcome.broken:
		ui.announce("%s CRIPPLED   %s DAMAGE" % [zone.to_upper(), outcome.damage])
	else:
		ui.announce("%s HIT   %s DAMAGE" % [zone.to_upper(), outcome.damage])
	mission.register_hit(actor, outcome, combat.combo, city.spawn_points)

func _feedback_effect(kind: String, point: Vector3) -> void:
	feedback.play_cue(kind, point)
	feedback.burst(point, kind)

func _action(command: String, payload: Variant) -> void:
	match command:
		"hunt", "training": _start(command, SPAWN)
		"pause": _pause()
		"resume": _resume()
		"restart":
			if mode == "coop":
				coop.send_lobby_action("restart_match")
			else:
				_start(mode, SPAWN)
		"menu":
			if not coop.player_id.is_empty() or coop.connection_state == "connecting":
				coop.leave_room()
			_show_menu()
		"settings":
			settings_back = ui.screen
			ui.show_settings(save.settings)
		"back": _settings_back()
		"setting", "debug_setting":
			if command == "setting":
				save.settings[payload[0]] = payload[1]
			else:
				save.settings.debug[payload[0]] = payload[1]
			_apply_settings()
			save.persist()
		"multiplayer": ui.show_multiplayer(save.settings.nickname)
		"browse", "create", "join", "join_selected": _matchmaking(command, payload)
		"leave":
			coop.leave_room()
			_show_menu()
			ui.show_multiplayer(save.settings.nickname)
		"ready": coop.send_lobby_action("unready" if _mine.get("ready", false) else "ready")
		"start": coop.send_lobby_action("start_match")

func _matchmaking(command: String, fields: Dictionary) -> void:
	var nickname := String(fields.nickname) if not String(fields.nickname).is_empty() else "Scout"
	save.settings.nickname = nickname
	save.persist()
	match command:
		"browse": coop.list_rooms(fields.host)
		"create":
			_accept_room_snapshots = true
			var operation := String(fields.room_name) if not String(fields.room_name).is_empty() else "Valkenburg Defense"
			coop.create_room(nickname, operation, fields.public, fields.host)
		"join":
			if String(fields.code).is_empty():
				ui.status("Enter a room code.")
			else:
				_accept_room_snapshots = true
				coop.join_room_by_code(fields.code, nickname, fields.host)
		"join_selected":
			if fields.room_id != null:
				_accept_room_snapshots = true
				coop.join_room_by_id(str(fields.room_id), nickname, fields.host)

func _start(kind: String, feet: Vector3, facing := PI) -> void:
	mode = kind
	_paused = false
	_tactical = false
	_grabber = null
	_last_ping = ""
	feedback.clear_effects()
	combat.reset()
	_clear_remote()
	city.set_training(kind == "training")
	mission.start(kind, city.spawn_points)
	mission.process_mode = Node.PROCESS_MODE_INHERIT
	player.respawn(feet, facing)
	player.active = true
	player.control_enabled = true
	ui.play()
	ui.set_tactical(false)
	if kind != "coop":
		player.capture_pointer()
	_update_hud()

func _pause() -> void:
	if ui.screen != "play":
		return
	_paused = true
	_tactical = false
	player.release_pointer()
	player.control_enabled = false
	player.active = mode == "coop"
	if mode != "coop":
		mission.process_mode = Node.PROCESS_MODE_DISABLED
	ui.show_pause(mode == "coop", mode != "coop" or bool(_mine.get("isLeader", false)))

func _resume(capture := true) -> void:
	_paused = false
	if combat.hit_stop <= 0.0:
		mission.process_mode = Node.PROCESS_MODE_INHERIT
	player.active = mode == "coop" or combat.hit_stop <= 0.0
	player.control_enabled = true
	ui.play()
	if capture:
		player.capture_pointer()

func _settings_back() -> void:
	if settings_back == "pause":
		ui.show_pause(mode == "coop", mode != "coop" or bool(_mine.get("isLeader", false)))
	else:
		_show_menu()

func _show_menu() -> void:
	_accept_room_snapshots = false
	mode = ""
	_paused = false
	_tactical = false
	_grabber = null
	_snapshot_tick = -1
	_mine = {}
	_match_snapshot = {}
	player.active = false
	player.control_enabled = false
	player.release_pointer()
	mission.clear()
	combat.reset()
	city.set_training(false)
	feedback.clear_effects()
	_clear_remote()
	ui.show_menu(save.progress, coop.is_available())

func _on_result(success: bool) -> void:
	player.control_enabled = false
	player.release_pointer()
	_tactical = false
	if success:
		save.record(mode, mission.score, mission.rank(), mission.kills, mission.elapsed)
	var retry: bool = mode != "coop" or _mine.get("isLeader", false)
	ui.show_result(success, mission.rank(), mission.score, mission.kills, mission.elapsed, retry)

func _apply_settings() -> void:
	player.camera.sensitivity = float(save.settings.mouseSensitivity)
	player.camera.target_distance = float(save.settings.cameraDistance)
	Player.set_tactical_overlay_key(save.settings.tacticalOverlayKey == "Tab")
	var quality := ["low", "medium", "high"].find(save.settings.graphicsQuality)
	city.set_quality(quality)
	feedback.master_volume = save.settings.masterVolume

func _send_input(frame: Dictionary) -> void:
	if mode != "coop" or mission.is_finished or coop.connection_state != "connected":
		return
	frame.lockedTitanId = combat.locked.actor_id if combat.has_target() else null
	frame.lockedZone = combat.zone
	var sequence := coop.send_input_frame(frame)
	if sequence > 0:
		player.record_prediction(sequence, frame)

func _send_attack(weapon: String, heavy: bool) -> void:
	var origin := player.camera.global_position
	var direction := player.aim_direction()
	coop.send_attack_intent({
		"weaponType": weapon, "isHeavy": heavy, "aimYaw": player.camera_yaw,
		"aimOrigin": [origin.x, origin.y, origin.z], "aimDir": [direction.x, direction.y, direction.z],
		"targetTitanId": combat.locked.actor_id if combat.has_target() else null, "targetZone": combat.zone,
	})

func _connection_changed(state: String, reason: String) -> void:
	match state:
		"connecting": ui.status("Connecting to Colyseus…")
		"reconnecting": ui.status("Reconnecting to squad…")
		"connected": ui.status("Connected")
		"disconnected":
			_accept_room_snapshots = false
			if mode == "coop" or ui.screen == "lobby":
				_show_menu()
				ui.show_multiplayer(save.settings.nickname)
			if not reason.is_empty():
				ui.status(reason)

func _on_snapshot(snapshot: Dictionary) -> void:
	if not _accept_room_snapshots:
		return
	var phase := String(snapshot.phase)
	var new_round := _is_restarted_round(snapshot)
	_mine = snapshot.players.get(coop.player_id, {})
	_match_snapshot = snapshot
	if phase == "lobby":
		if ui.screen != "lobby":
			ui.show_lobby()
		ui.update_lobby(snapshot, coop.player_id)
		return
	if _mine.is_empty():
		return
	var tick := int(snapshot.serverTick)
	if phase == "playing" and (mode != "coop" or mission.is_finished or new_round):
		_start("coop", Data.vec(_mine.position), float(_mine.yaw))
		_snapshot_tick = -1
	var delta := clampf(float(tick - _snapshot_tick) / 60.0, 0.016, 0.25)
	_snapshot_tick = tick
	mission.sync_room(snapshot)
	remote_squad.sync_players(snapshot.players, coop.player_id)
	_sync_projectiles(snapshot.get("projectiles", []))
	player.apply_server_snapshot(_mine, delta, _hook_marker(_mine.leftHook), _hook_marker(_mine.rightHook))
	if phase == "victory" or phase == "defeat":
		mission.end(phase == "victory")
	_update_hud()

func _is_restarted_round(snapshot: Dictionary) -> bool:
	if mode != "coop" or snapshot.phase != "playing" or float(snapshot.elapsedSeconds) > 0.1:
		return false
	var previous: Dictionary = _match_snapshot.get("titans", {})
	var current: Dictionary = snapshot.titans
	if previous.is_empty() or current.is_empty():
		return false
	for id in current:
		if previous.has(id):
			return false
	return true

func _hook_marker(hook: Dictionary) -> Node3D:
	var id: Variant = hook.get("attachedTitanId")
	var zone: Variant = hook.get("attachedZone")
	if id == null or zone == null:
		return null
	var actor := mission.actor_for(str(id))
	return actor.zones[zone].marker if actor != null and actor.zones.has(zone) else null

func _on_network_combat(event: Dictionary) -> void:
	if mode != "coop":
		return
	var point := Data.vec(event.get("worldPos", [0, 0, 0]))
	var kind := String(event.type)
	var relevant: bool = event.get("attackerId") == coop.player_id or event.get("targetPlayerId") == coop.player_id
	match kind:
		"thunder_spear_fired": feedback.play_cue("spear_launch", point)
		"thunder_spear_exploded": _feedback_effect("explosion", point)
		"damage_applied": _feedback_effect("glance" if event.get("glanced", false) else "impact", point)
		"titan_killed": _feedback_effect("critical", point)
		"resupply": feedback.play_cue("resupply", point)
		"grab_escaped": feedback.play_cue("grab_escape", point)
		"player_damaged", "player_grabbed":
			if event.get("targetPlayerId") == coop.player_id:
				feedback.play_cue("impact", point)
				player.camera.add_shake(0.32, 0.22)
	if relevant and event.get("message", "") != "":
		ui.announce(event.message)

func _sync_projectiles(shots: Array) -> void:
	var live := {}
	for shot: Dictionary in shots:
		var id := String(shot.id)
		var point := Data.vec(shot.position)
		live[id] = true
		if not _projectiles.has(id):
			var node := feedback.make_projectile()
			add_child(node)
			node.global_position = point
			var motion := Data.vec(shot.velocity)
			if not motion.is_zero_approx():
				node.look_at(point + motion, Vector3.FORWARD if absf(motion.normalized().y) > 0.98 else Vector3.UP, true)
			_projectiles[id] = {"node": node, "target": point}
		else:
			_projectiles[id].target = point
	for id: String in _projectiles.keys():
		if not live.has(id):
			_projectiles[id].node.queue_free()
			_projectiles.erase(id)

func _update_remote_projectiles(delta: float) -> void:
	for entry: Dictionary in _projectiles.values():
		var node: Node3D = entry.node
		node.global_position = node.global_position.lerp(entry.target, 1.0 - exp(-25.0 * delta))

func _clear_remote() -> void:
	remote_squad.clear()
	_sync_projectiles([])

func _ping_actions() -> void:
	var target := combat.locked.actor_id if combat.has_target() else ""
	var point := combat.target_position() if combat.has_target() else player.global_position
	if Input.is_action_just_pressed("ping"):
		coop.send_team_ping(point, target if not target.is_empty() else null)
	for index in QUICK_CHAT.size():
		if Input.is_action_just_pressed("quick_chat_%s" % (index + 1)):
			coop.send_team_ping(point, target if not target.is_empty() else null, QUICK_CHAT[index])

func _update_hud() -> void:
	if mode.is_empty():
		return
	var hint := ""
	if player.downed:
		hint = "DOWNED   /   %.1f s   ·   Revive %.0f%%" % [_mine.get("downedTimer", 0.0), float(_mine.get("reviveProgress", 0.0)) * 100.0]
	elif player.is_grabbed():
		hint = "GRABBED  /  Press F, Space or V to escape   %.0f%%" % (player.grab_escape_progress * 100.0)
	elif city.nearby_depot(player.global_position):
		hint = "R  /  Resupply at depot"
	elif player.blade_durability <= 0 and player.spare_blades > 0:
		hint = "R  /  Replace dulled blades"
	elif ui.screen == "play" and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		hint = "Click to aim"
	elif mode == "training" and mission.stage == 2 and player.odm.any_active():
		hint = "Hold Shift to boost"
	var debug := "%s FPS   ·   %s draws" % [Engine.get_frames_per_second(), Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)] if save.settings.debug.showPerformanceOverlay else ""
	if save.settings.debug.showAIStates and combat.has_target():
		debug += "\n%s · %s" % [combat.locked.variant, combat.locked.state]
	ui.update_hud({
		"title": mission.title(), "objective": mission.objective(), "detail": _mission_detail(),
		"elapsed": mission.elapsed, "score": mission.score, "speed": player.velocity.length(),
		"network": "%s ms" % coop.rtt_ms if mode == "coop" else "",
		"health": player.health, "gas": player.gas, "blade": player.blade_durability,
		"spare_blades": player.spare_blades, "thunder_spears": player.thunder_spears,
		"left_ready": player.gas > 1.0 and not player.grapple_previews[0].is_empty(),
		"right_ready": player.gas > 1.0 and not player.grapple_previews[1].is_empty(),
		"left_latched": player.odm.left_hook.active, "right_latched": player.odm.right_hook.active,
		"hint": hint, "debug": debug,
	})
	if mode == "coop":
		_show_new_ping()
	if not _tactical:
		return
	var enemies: Array[Vector3] = []
	var squad: Array[Vector3] = []
	var pings: Array[Vector3] = []
	var roster: PackedStringArray = []
	for actor in mission.actors:
		if not actor.is_dead():
			enemies.append(actor.global_position)
	for member: Dictionary in _match_snapshot.get("players", {}).values():
		if member.id != coop.player_id:
			squad.append(Data.vec(member.position))
		roster.append("%s · %s · %s HP · %s K / %s A · %s pts" % [
			member.nickname, member.lifeState, roundi(member.health), member.kills, member.assists, member.score])
	for ping: Dictionary in _match_snapshot.get("pings", []):
		pings.append(Data.vec(ping.position))
	ui.update_tactical(player.global_position, player.yaw, enemies, squad, pings, "\n".join(roster))

func _mission_detail() -> String:
	var detail := mission.detail()
	if mode == "training" and save.settings.tacticalOverlayKey == "Tab":
		return detail.replace("Press Tab", "Press T")
	return detail

func _show_new_ping() -> void:
	var pings: Array = _match_snapshot.get("pings", [])
	if pings.is_empty():
		return
	var newest: Dictionary = pings.back()
	if str(newest.id) != _last_ping:
		_last_ping = str(newest.id)
		ui.announce("%s  /  %s" % [newest.senderName, newest.message])
