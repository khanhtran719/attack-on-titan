extends Node
## Integration-test-only endpoint that exercises the same CoopClient as the game.

const Client = preload("res://multiplayer/coop_client.gd")

var _client := Client.new()
var _page: JavaScriptObject
var _command: JavaScriptObject


func _ready() -> void:
	_page = JavaScriptBridge.get_interface("titanTest")
	_client.connection_changed.connect(func(state: String, reason: String) -> void:
		_emit("connection", {"state": state, "reason": reason})
	)
	_client.rooms_changed.connect(func(rooms: Array) -> void: _emit("rooms", {"rooms": rooms}))
	_client.room_error_received.connect(func(error: Dictionary) -> void: _emit("room_error", error))
	_client.combat_event_received.connect(func(event: Dictionary) -> void: _emit("combat_event", event))
	_client.snapshot_received.connect(func(snapshot: Dictionary) -> void:
		_emit("snapshot", {
			"snapshot": snapshot,
			"playerId": _client.player_id,
			"roomCode": _client.room_code,
			"rttMs": _client.rtt_ms,
		})
	)
	add_child(_client)
	_command = JavaScriptBridge.create_callback(_queue_command)
	_page.command = _command
	_page.available = _client.is_available()


func _queue_command(arguments: Array) -> void:
	_execute.call_deferred(int(arguments[0]), str(arguments[1]), JSON.parse_string(arguments[2]))


func _execute(request: int, method: String, args: Array) -> void:
	var result: Variant = null
	match method:
		"listRooms":
			_client.list_rooms(args[0])
		"createRoom":
			_client.create_room(args[0], args[1], args[2], args[3])
		"joinRoomByCode":
			_client.join_room_by_code(args[0], args[1], args[2])
		"sendLobbyAction":
			_client.send_lobby_action(args[0], args[1])
		"sendInputFrame":
			result = _client.send_input_frame(JSON.parse_string(args[0]))
		"sendAttackIntent":
			result = _client.send_attack_intent(JSON.parse_string(args[0]))
		"sendTeamPing":
			var ping: Dictionary = JSON.parse_string(args[0])
			var point: Array = ping.worldPos
			_client.send_team_ping(Vector3(point[0], point[1], point[2]), ping.targetTitanId, ping.quickChatKey)
		"leaveRoom":
			_client.leave_room()
	_page.complete(request, result)


func _emit(kind: String, payload: Dictionary) -> void:
	_page.emitEvent(kind, JSON.stringify(payload))
