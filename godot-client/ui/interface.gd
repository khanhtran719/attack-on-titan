class_name TitanInterface
extends CanvasLayer

signal action(name: String, payload: Variant)

const Tactical := preload("res://ui/tactical_map.gd")
const GameData := preload("res://resources/game_data.gd")
const INK := Color("0d191d")
const PAPER := Color("ede7d8")
const MUTED := Color("a6b9b7")
const CYAN := Color("5ed8c5")
const GOLD := Color("e9bc80")
const RED := Color("ee8879")

var screen := ""
var root: Control
var overlay: Control
var hud: Control
var mission: Label
var objective: Label
var detail: Label
var stats: Label
var meters: Dictionary
var gear: Label
var hint: Label
var banner: Label
var crosshair: Label
var marker: Label
var debug_line: Label
var _focus: Button
var _banner_time := 0.0
var _tactical: PanelContainer
var _map: Tactical
var _squad: Label
var _room_roster: Label
var _ping_labels: Dictionary = {}
var _connection: Label
var _room_choices: OptionButton
var _ready_button: Button
var _start_button: Button
var _nickname: LineEdit
var _endpoint: LineEdit
var _room_name: LineEdit
var _code: LineEdit
var _public: CheckBox
var _network_settings := {"nickname": "Scout", "host": "", "room_name": "", "code": "", "public": true}

func _ready() -> void:
	root = Control.new()
	add_child(root)
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = _theme()
	_build_hud()

func show_menu(progress: Dictionary, online: bool) -> void:
	var content := _open("menu", "TITAN HUNTER", "VALKENBURG DISTRICT COMMAND", 580)
	content.add_child(_label("Deploy with the Vanguard and reclaim Valkenburg.", 19, MUTED))
	content.add_child(_button("Deploy  /  District Hunt", "hunt", true))
	content.add_child(_button("Cadet Proving Grounds", "training"))
	var multiplayer := _button("Co-op Operations", "multiplayer")
	multiplayer.disabled = not online
	if not online:
		multiplayer.tooltip_text = "Co-op is available in the Web export."
	content.add_child(multiplayer)
	content.add_child(_button("Settings", "settings"))
	content.add_child(_label("Best %s  ·  %s Titans slain  ·  Training %s" % [progress.highScore, progress.totalTitansSlain,
		"complete" if progress.trainingCompleted else "available"], 15, MUTED))
	_finish_focus()

func show_pause(coop: bool, can_restart := true) -> void:
	var content := _open("pause", "OPERATION PAUSED" if not coop else "SQUAD MENU", "VALKENBURG DISTRICT", 460)
	content.add_child(_button("Resume", "resume", true))
	content.add_child(_button("Settings", "settings"))
	if can_restart:
		content.add_child(_button("Restart mission", "restart"))
	content.add_child(_button("Return to command", "menu"))
	_finish_focus()

func show_result(success: bool, rank: String, score: int, kills: int, time: float, allow_retry: bool) -> void:
	var content := _open("result", "MISSION COMPLETE" if success else "MISSION FAILED", "OPERATION REPORT", 510)
	content.add_child(_label("Rank %s    /    %s points" % [rank, score], 25, GOLD))
	content.add_child(_label("%s Titans eliminated    ·    %s" % [kills, _clock(time)], 18, MUTED))
	if allow_retry:
		content.add_child(_button("Restart mission", "restart", true))
	content.add_child(_button("Return to command", "menu"))
	_finish_focus()

func show_settings(settings: Dictionary) -> void:
	var content := _open("settings", "SETTINGS", "VANGUARD EQUIPMENT", 530)
	_slider(content, "Mouse sensitivity", "mouseSensitivity", settings.mouseSensitivity, 0.2, 3.0, 0.05)
	_slider(content, "Camera distance", "cameraDistance", settings.cameraDistance, 3.0, 10.0, 0.1)
	_slider(content, "Master volume", "masterVolume", settings.masterVolume, 0, 1.0, 0.05)
	_option(content, "Graphics quality", "graphicsQuality", ["low", "medium", "high"], settings.graphicsQuality)
	_option(content, "Tactical overlay", "tacticalOverlayKey", ["KeyH", "Tab"], settings.tacticalOverlayKey)
	var toggles := GridContainer.new()
	toggles.columns = 2
	content.add_child(toggles)
	var debug_labels := {"showColliders": "City colliders", "showGrappleAnchors": "Grapple anchors",
		"showTitanHitboxes": "Titan hitboxes", "showWeakPoints": "Weak points", "showVelocityVectors": "Velocity",
		"showAIStates": "AI states", "showPerformanceOverlay": "Performance"}
	for key: String in debug_labels:
		var toggle := CheckBox.new()
		toggle.text = debug_labels[key]
		toggle.button_pressed = settings.debug[key]
		toggle.toggled.connect(func(value: bool) -> void: action.emit("debug_setting", [key, value]))
		toggles.add_child(toggle)
	content.add_child(_button("Back", "back", true))
	_finish_focus()

func show_multiplayer(callsign: String) -> void:
	_network_settings.nickname = callsign
	var content := _open("multiplayer", "CO-OP OPERATIONS", "VANGUARD SQUAD", 650)
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 10)
	content.add_child(grid)
	_nickname = _field(grid, "Callsign", _network_settings.nickname, "Scout")
	_nickname.max_length = 16
	_endpoint = _field(grid, "Server", _network_settings.host, "Auto or http://localhost:2567")
	_room_name = _field(grid, "Operation name", _network_settings.room_name, "Valkenburg Defense")
	_room_name.max_length = 32
	_code = _field(grid, "Room code", _network_settings.code, "Enter invite code")
	_code.max_length = 16
	_public = CheckBox.new()
	_public.text = "List room publicly"
	_public.button_pressed = _network_settings.public
	content.add_child(_public)
	var buttons := HBoxContainer.new()
	content.add_child(buttons)
	buttons.add_child(_button("Create room", "create", true))
	buttons.add_child(_button("Join by code", "join"))
	buttons.add_child(_button("Find rooms", "browse"))
	var browser := HBoxContainer.new()
	content.add_child(browser)
	_room_choices = OptionButton.new()
	_room_choices.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_room_choices.add_item("No rooms loaded")
	_room_choices.set_item_disabled(0, true)
	browser.add_child(_room_choices)
	browser.add_child(_button("Join selected", "join_selected"))
	_connection = _label("", 16, GOLD)
	content.add_child(_connection)
	content.add_child(_button("Back to command", "menu"))
	_finish_focus()

func show_lobby() -> void:
	var content := _open("lobby", "SQUAD LOBBY", "VANGUARD SQUAD", 570)
	_room_roster = _label("Connecting…", 19, PAPER)
	_room_roster.custom_minimum_size.y = 130
	content.add_child(_room_roster)
	_connection = _label("", 16, GOLD)
	content.add_child(_connection)
	_ready_button = _button("Ready up", "ready", true)
	_start_button = _button("Start operation", "start")
	content.add_child(_ready_button)
	content.add_child(_start_button)
	content.add_child(_button("Leave room", "leave"))
	_finish_focus()

func update_lobby(snapshot: Dictionary, own_id: String) -> void:
	if screen != "lobby":
		return
	var lines := ["%s    /    %s" % [snapshot.roomName, snapshot.roomCode], ""]
	var players: Dictionary = snapshot.players
	var all_ready := not players.is_empty()
	for member: Dictionary in players.values():
		lines.append("%s%s     %s" % [member.nickname, "  [Leader]" if member.isLeader else "", "Ready" if member.ready else "Standby"])
		all_ready = all_ready and (bool(member.ready) or bool(member.isLeader) or not bool(member.connected))
	_room_roster.text = "\n".join(lines)
	var mine: Dictionary = players.get(own_id, {})
	_ready_button.disabled = mine.is_empty()
	_ready_button.text = "Stand down" if mine.get("ready", false) else "Ready up"
	_start_button.disabled = not all_ready or not mine.get("isLeader", false)

func update_rooms(rooms: Array) -> void:
	if screen != "multiplayer":
		return
	_room_choices.clear()
	for entry: Dictionary in rooms:
		_room_choices.add_item("%s  /  %s of %s" % [entry.roomName, entry.playerCount, entry.maxPlayers])
		_room_choices.set_item_metadata(_room_choices.item_count - 1, entry.roomId)
	if rooms.is_empty():
		_room_choices.add_item("No public rooms")
		_room_choices.set_item_disabled(0, true)

func status(message: String) -> void:
	if is_instance_valid(_connection) and screen in ["lobby", "multiplayer"]:
		_connection.text = message
	elif hud.visible:
		announce(message)

func play() -> void:
	_banner_time = 0.0
	_clear_overlay()
	screen = "play"
	hud.show()

func set_tactical(open: bool) -> void:
	_tactical.visible = open

func update_tactical(feet: Vector3, yaw: float, enemies: Array[Vector3], squad: Array[Vector3], pings: Array[Vector3], roster: String) -> void:
	if not _tactical.visible:
		return
	_map.player_position = feet
	_map.player_yaw = yaw
	_map.enemies = enemies
	_map.squad = squad
	_map.pings = pings
	_map.queue_redraw()
	_squad.text = roster

func update_hud(view: Dictionary) -> void:
	if not hud.visible:
		return
	mission.text = view.title
	objective.text = view.objective
	detail.text = view.detail
	stats.text = "%s  /  %s PTS\n%s m/s    %s" % [_clock(view.elapsed), view.score, roundi(view.speed), view.network]
	for key: String in meters:
		meters[key].value = view[key]
	gear.text = "%s spare blades     %s Thunder Spears" % [view.spare_blades, view.thunder_spears]
	crosshair.text = "%s   ·   %s" % [view.hook_left, view.hook_right]
	hint.text = view.hint
	debug_line.text = view.debug

func show_marker(camera: Camera3D, point: Vector3, text: String, tint: Color = GOLD) -> void:
	marker.visible = hud.visible and not text.is_empty() and not camera.is_position_behind(point)
	if marker.visible:
		marker.text = text
		marker.modulate = tint
		marker.position = (camera.unproject_position(point) - marker.size * 0.5).clamp(Vector2(12, 114), root.size - marker.size - Vector2(12, 110))

func update_pings(camera: Camera3D, pings: Array, feet: Vector3) -> void:
	var visible_ids: Dictionary = {}
	for ping: Dictionary in pings:
		var id := str(ping.id)
		var position := GameData.vec(ping.position)
		if camera.is_position_behind(position):
			continue
		var point := camera.unproject_position(position)
		if not Rect2(Vector2.ZERO, root.size).has_point(point):
			continue
		visible_ids[id] = true
		if not _ping_labels.has(id):
			var tag := _label("", 16, CYAN)
			tag.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			hud.add_child(tag)
			_ping_labels[id] = tag
		var label: Label = _ping_labels[id]
		label.text = "PING  %s · %s m" % [ping.message, roundi(position.distance_to(feet))]
		label.position = point - Vector2(label.size.x * 0.5, 38)
	for id: String in _ping_labels.keys():
		if not visible_ids.has(id):
			_ping_labels[id].queue_free()
			_ping_labels.erase(id)

func announce(message: String) -> void:
	banner.text = message
	_banner_time = 2.4

func _process(delta: float) -> void:
	_banner_time -= delta
	banner.visible = _banner_time > 0.0

func _build_hud() -> void:
	hud = Control.new()
	root.add_child(hud)
	hud.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var left := VBoxContainer.new()
	left.position = Vector2(28, 24)
	left.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(left)
	mission = _label("", 14, CYAN)
	objective = _label("", 24, PAPER)
	detail = _label("", 15, MUTED)
	for node in [mission, objective, detail]:
		left.add_child(node)
	stats = _label("", 18, PAPER)
	stats.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_corner(stats, Control.PRESET_TOP_RIGHT, Rect2(-300, 24, 272, 60))
	var supplies := VBoxContainer.new()
	_corner(supplies, Control.PRESET_BOTTOM_LEFT, Rect2(28, -150, 255, 126))
	for entry in [["health", "HEALTH", RED], ["gas", "ODM GAS", CYAN], ["blade", "BLADE EDGE", GOLD]]:
		_meter(supplies, entry[0], entry[1], entry[2])
	gear = _label("", 15, MUTED)
	supplies.add_child(gear)
	crosshair = _label("", 25, PAPER)
	crosshair.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	crosshair.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_corner(crosshair, Control.PRESET_CENTER, Rect2(-130, -20, 260, 40))
	banner = _label("", 21, GOLD)
	banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_corner(banner, Control.PRESET_CENTER, Rect2(-370, -115, 740, 40))
	hint = _label("", 17, CYAN)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_corner(hint, Control.PRESET_CENTER_BOTTOM, Rect2(-380, -68, 760, 33))
	debug_line = _label("", 14, MUTED)
	debug_line.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_corner(debug_line, Control.PRESET_BOTTOM_RIGHT, Rect2(-410, -90, 382, 68))
	marker = _label("", 17, GOLD)
	marker.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	hud.add_child(marker)
	var tactical := PanelContainer.new()
	_tactical = tactical
	_corner(tactical, Control.PRESET_CENTER, Rect2(-285, -230, 570, 460))
	var column := VBoxContainer.new()
	tactical.add_child(column)
	column.add_child(_label("TACTICAL MAP", 21, CYAN))
	_map = Tactical.new()
	_map.custom_minimum_size = Vector2(525, 325)
	_map.city_layout = GameData.get_data().city
	column.add_child(_map)
	_squad = _label("", 15, PAPER)
	column.add_child(_squad)
	tactical.hide()
	hud.hide()

func _meter(parent: VBoxContainer, key: String, caption: String, tint: Color) -> void:
	var row := HBoxContainer.new()
	parent.add_child(row)
	var title := _label(caption, 13, MUTED)
	title.custom_minimum_size.x = 85
	row.add_child(title)
	var bar := ProgressBar.new()
	bar.show_percentage = false
	bar.custom_minimum_size = Vector2(115, 9)
	bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bar.add_theme_stylebox_override("background", _box(Color("233437"), Color("354c4d"), 0))
	bar.add_theme_stylebox_override("fill", _box(tint, tint, 0))
	row.add_child(bar)
	meters[key] = bar

func _corner(node: Control, preset: int, rect: Rect2) -> void:
	hud.add_child(node)
	node.set_anchors_and_offsets_preset(preset, Control.PRESET_MODE_KEEP_SIZE)
	node.offset_left = rect.position.x
	node.offset_right = rect.end.x
	node.offset_top = rect.position.y
	node.offset_bottom = rect.end.y
	node.mouse_filter = Control.MOUSE_FILTER_IGNORE

func _open(kind: String, title: String, subtitle: String, width: int) -> VBoxContainer:
	_clear_overlay()
	screen = kind
	hud.visible = kind in ["pause", "result"]
	_tactical.hide()
	var shade := ColorRect.new()
	overlay = shade
	shade.color = Color(0.025, 0.05, 0.065, 0.72)
	root.add_child(shade)
	shade.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var aligner := CenterContainer.new()
	shade.add_child(aligner)
	aligner.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var panel := PanelContainer.new()
	panel.custom_minimum_size.x = width
	aligner.add_child(panel)
	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 9)
	panel.add_child(content)
	content.add_child(_label(subtitle, 14, CYAN))
	content.add_child(_label(title, 37, PAPER))
	content.add_child(HSeparator.new())
	return content

func _clear_overlay() -> void:
	if is_instance_valid(overlay):
		root.remove_child(overlay)
		overlay.queue_free()
	overlay = null
	_focus = null

func _button(caption: String, command: String, primary := false) -> Button:
	var button := Button.new()
	button.text = caption
	button.custom_minimum_size.y = 41
	if primary:
		button.add_theme_color_override("font_color", INK)
		button.add_theme_color_override("font_hover_color", INK)
		button.add_theme_color_override("font_focus_color", INK)
		button.add_theme_stylebox_override("normal", _box(CYAN, CYAN, 8))
		button.add_theme_stylebox_override("hover", _box(Color("a7eddf"), CYAN, 8))
	if _focus == null and primary:
		_focus = button
	button.pressed.connect(func() -> void:
		var payload: Variant = null
		if screen == "multiplayer" and command in ["create", "join", "browse", "join_selected"]:
			_network_settings = {"nickname": _nickname.text.strip_edges(), "host": _endpoint.text.strip_edges(),
				"room_name": _room_name.text.strip_edges(), "code": _code.text.strip_edges(), "public": _public.button_pressed}
			payload = _network_settings.duplicate()
			if command == "join_selected":
				payload["room_id"] = _room_choices.get_selected_metadata()
		action.emit(command, payload))
	return button

func _finish_focus() -> void:
	if is_instance_valid(_focus):
		_apply_focus.call_deferred(_focus)

func _apply_focus(button: Button) -> void:
	if is_instance_valid(button) and button == _focus and button.is_inside_tree():
		button.grab_focus()

func _field(parent: GridContainer, caption: String, current: String, placeholder: String) -> LineEdit:
	parent.add_child(_label(caption, 16, MUTED))
	var input := LineEdit.new()
	input.text = current
	input.placeholder_text = placeholder
	input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(input)
	return input

func _label(value: String, font_size: int, tint: Color) -> Label:
	var label := Label.new()
	label.text = value
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", tint)
	label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.55))
	label.add_theme_constant_override("shadow_offset_x", 1)
	label.add_theme_constant_override("shadow_offset_y", 1)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return label

func _slider(parent: VBoxContainer, caption: String, key: String, value: float, minimum: float, maximum: float, step: float) -> void:
	var row := HBoxContainer.new()
	parent.add_child(row)
	var label := _label("%s  %.2f" % [caption, value], 16, MUTED)
	label.custom_minimum_size.x = 175
	row.add_child(label)
	var slider := HSlider.new()
	slider.min_value = minimum
	slider.max_value = maximum
	slider.step = step
	slider.value = value
	slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(slider)
	slider.value_changed.connect(func(amount: float) -> void:
		label.text = "%s  %.2f" % [caption, amount]
		action.emit("setting", [key, amount]))

func _option(parent: VBoxContainer, caption: String, key: String, values: Array, value: String) -> void:
	var row := HBoxContainer.new()
	parent.add_child(row)
	var label := _label(caption, 16, MUTED)
	label.custom_minimum_size.x = 175
	row.add_child(label)
	var selector := OptionButton.new()
	for text: String in values:
		selector.add_item(text)
	selector.select(maxi(0, values.find(value)))
	row.add_child(selector)
	selector.item_selected.connect(func(index: int) -> void: action.emit("setting", [key, values[index]]))

func _clock(seconds: float) -> String:
	return "%02d:%02d" % [floori(seconds / 60.0), int(seconds) % 60]

func _box(background: Color, border: Color, padding: float) -> StyleBoxFlat:
	var box := StyleBoxFlat.new()
	box.bg_color = background
	box.border_color = border
	box.set_border_width_all(1)
	box.set_corner_radius_all(2)
	for side in [SIDE_LEFT, SIDE_RIGHT, SIDE_TOP, SIDE_BOTTOM]:
		box.set_content_margin(side, padding)
	return box

func _theme() -> Theme:
	var skin := Theme.new()
	skin.default_font_size = 17
	skin.set_stylebox("panel", "PanelContainer", _box(Color("101d21"), Color("43625e"), 23))
	for type in ["Button", "OptionButton"]:
		skin.set_color("font_color", type, PAPER)
		skin.set_stylebox("normal", type, _box(Color("203238"), Color("46605f"), 8))
		skin.set_stylebox("hover", type, _box(Color("314c4e"), CYAN, 8))
		skin.set_stylebox("pressed", type, _box(Color("1a272b"), CYAN, 8))
		var focus := _box(Color.TRANSPARENT, GOLD, 0)
		focus.set_border_width_all(2)
		skin.set_stylebox("focus", type, focus)
	skin.set_stylebox("normal", "LineEdit", _box(Color("142327"), Color("42615d"), 8))
	return skin
