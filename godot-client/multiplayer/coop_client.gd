class_name CoopClient
extends Node
## Godot-facing transport for the original Colyseus browser client.

signal connection_changed(state: String, reason: String)
signal rooms_changed(rooms: Array)
signal snapshot_received(snapshot: Dictionary)
signal combat_event_received(event: Dictionary)
signal room_error_received(error: Dictionary)

var player_id: String = ""
var room_code: String = ""
var connection_state: String = "disconnected"
var latest_snapshot: Dictionary = {}
var rtt_ms: int = 12
var jitter_ms: int = 0

var _bridge: JavaScriptObject
# JavaScriptBridge only keeps a weak reference to Godot callbacks.
var _callback: JavaScriptObject


func _ready() -> void:
	if not OS.has_feature("web"):
		return
	var factory := JavaScriptBridge.get_interface("TitanCoop")
	if factory == null:
		push_warning("Co-op bridge is missing. Export and serve coop-bridge.js alongside the game.")
		return
	_callback = JavaScriptBridge.create_callback(_receive)
	_bridge = factory.create(_callback)


func _exit_tree() -> void:
	if _bridge != null:
		_bridge.dispose()
		_bridge = null
	_callback = null


func is_available() -> bool:
	return _bridge != null


func list_rooms(host: String = "") -> void:
	if _require_bridge():
		_bridge.listRooms(host)


func create_room(nickname: String, room_name: String, is_public: bool, host: String = "") -> void:
	if _require_bridge():
		_bridge.createRoom(nickname, room_name, is_public, host)


func join_room_by_code(code: String, nickname: String, host: String = "") -> void:
	if _require_bridge():
		_bridge.joinRoomByCode(code, nickname, host)


func join_room_by_id(id: String, nickname: String, host: String = "") -> void:
	if _require_bridge():
		_bridge.joinRoomById(id, nickname, host)


func leave_room() -> void:
	if _bridge != null:
		_bridge.leaveRoom()


func send_lobby_action(action: String, nickname: String = "") -> void:
	if _bridge != null:
		_bridge.sendLobbyAction(action, nickname)


func send_input_frame(frame: Dictionary) -> int:
	if _bridge == null:
		return 0
	return int(_bridge.sendInputFrame(JSON.stringify(frame)))


func send_attack_intent(intent: Dictionary) -> int:
	if _bridge == null:
		return 0
	return int(_bridge.sendAttackIntent(JSON.stringify(intent)))


func send_team_ping(
	world_position: Vector3, target_titan_id: Variant = null, quick_chat_key: String = ""
) -> void:
	if _bridge != null:
		_bridge.sendTeamPing(JSON.stringify({
			"worldPos": [world_position.x, world_position.y, world_position.z],
			"targetTitanId": target_titan_id,
			"quickChatKey": quick_chat_key,
		}))


func _require_bridge() -> bool:
	if is_available():
		return true
	room_error_received.emit({
		"code": "BRIDGE_UNAVAILABLE",
		"message": "Co-op is available in the exported Web game.",
	})
	return false


func _receive(arguments: Array) -> void:
	if arguments.size() != 2:
		return
	var data: Variant = JSON.parse_string(str(arguments[1]))
	if data is Dictionary:
		_dispatch.call_deferred(str(arguments[0]), data)


func _dispatch(event: String, data: Dictionary) -> void:
	match event:
		"connection":
			connection_state = str(data.get("state", "disconnected"))
			player_id = str(data.get("playerId", ""))
			if connection_state in ["connecting", "disconnected"]:
				room_code = ""
				latest_snapshot = {}
			connection_changed.emit(connection_state, str(data.get("reason", "")))
		"snapshot":
			var snapshot: Variant = data.get("snapshot")
			if snapshot is Dictionary:
				latest_snapshot = snapshot
				player_id = str(data.get("playerId", ""))
				room_code = str(data.get("roomCode", ""))
				rtt_ms = int(data.get("rttMs", 12))
				jitter_ms = int(data.get("jitterMs", 0))
				snapshot_received.emit(latest_snapshot)
		"rooms":
			var rooms: Variant = data.get("rooms")
			if rooms is Array:
				rooms_changed.emit(rooms)
		"combat_event":
			combat_event_received.emit(data)
		"room_error":
			room_error_received.emit(data)
