package webrtc.p2p.Controller;

import java.util.HashMap;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArraySet;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.util.StringUtils;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import webrtc.p2p.dto.SignalingMessage;
@Controller
public class WebRTCSignalingController {
    private static final String LOBBY_ID = "global-lobby";
    private static final int MAX_ROOMS = 100;
    private final Random random = new Random();

    @Autowired
    private final SimpMessagingTemplate messagingTemplate;
    
    // Track all users in lobby: userId -> UserInfo
    private final Map<String, UserInfo> lobbyUsers = new ConcurrentHashMap<>();
    
    // Track rooms: roomId -> Set of userIds
    private final Map<String, Set<String>> rooms = new ConcurrentHashMap<>();
    
    // Track which room a user is in: userId -> roomId
    private final Map<String, String> userRooms = new ConcurrentHashMap<>();

    public static class UserInfo {
        private final String userId;
        private boolean isCallActive;
        private long lastActive;

        public UserInfo(String userId) {
            this.userId = userId;
            this.isCallActive = false;
            this.lastActive = System.currentTimeMillis();
        }

        // Getters and setters
        public String getUserId() { return userId; }
        public boolean isCallActive() { return isCallActive; }
        public void setCallActive(boolean callActive) { 
            this.isCallActive = callActive; 
            this.lastActive = System.currentTimeMillis();
        }
        public long getLastActive() { return lastActive; }
    }

    public WebRTCSignalingController(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    

    @MessageMapping("/join")
public void handleJoin(@Payload SignalingMessage message, SimpMessageHeaderAccessor headerAccessor) {
    if (!isValidMessage(message) || !StringUtils.hasText(message.getSender())) {
        return;
    }
    
    String userId = message.getSender();
    System.out.println("User " + userId + " joining lobby");
    
    // Store user in session attributes
    if (headerAccessor.getSessionAttributes() != null) {
        headerAccessor.getSessionAttributes().put("userId", userId);
        System.out.println("User added in the websocket session with userId: " + userId);
    }

    // If user already exists, just update their status
    if (lobbyUsers.containsKey(userId)) {
        lobbyUsers.get(userId).setCallActive(false);
        System.out.println("User already exists in the lobby - updating status");
    } else {
        // Add new user to lobby
        UserInfo userInfo = new UserInfo(userId);
        lobbyUsers.put(userId, userInfo);
        System.out.println("New user added to lobby: " + userId);
    }

    // Broadcast full lobby status to all users
    broadcastFullLobbyStatus();
}

private void broadcastFullLobbyStatus() {
    Map<String, Object> lobbyStatus = new HashMap<>();
    
    // Prepare complete lobby status
    lobbyUsers.forEach((id, info) -> {
        Map<String, Object> userStatus = new HashMap<>();
        userStatus.put("active", info.isCallActive());
        userStatus.put("lastActive", info.getLastActive());
        lobbyStatus.put(id, userStatus);
    });
    
    // Create the complete payload
    SignalingMessage statusMessage = new SignalingMessage(
        "lobby-status", 
        lobbyStatus, 
        "server", 
        "all" // Indicates this is a broadcast
    );
    
    // Send to all connected clients
    messagingTemplate.convertAndSend("/topic/lobby-status", statusMessage);
    
    System.out.println("Broadcasted lobby status to all users");
}

    @EventListener
public void handleSessionDisconnect(SessionDisconnectEvent event) {
       SimpMessageHeaderAccessor accessor =
        SimpMessageHeaderAccessor.wrap(event.getMessage());
    String userId = (String) accessor.getSessionAttributes().get("userId");
    if (userId != null) {
        removeUserFromSystem(userId);
        broadcastFullLobbyStatus();   // push fresh lobby to all
        System.out.println("User disconnected (session closed): " + userId);
    }
}

   @MessageMapping("/start-call")
public void handleStartCall(@Payload SignalingMessage message, SimpMessageHeaderAccessor headerAccessor) {
    if (!isValidMessage(message) || !StringUtils.hasText(message.getSender())) {
        return;
    }
    
    String userId = message.getSender();
    UserInfo userInfo = lobbyUsers.get(userId);
    System.out.println("\n\n\n" + "in the start call for" + userInfo);
    
    if (userInfo == null) {
        return; // User not in lobby
    }
    
    // Mark user as call active
    userInfo.setCallActive(true);
    
    // Find a peer to connect with
    String peerId = findAvailablePeer(userId);
    
    if (peerId != null) {
        // Create a room for these two users
        String roomId = "room-" + random.nextInt(MAX_ROOMS);
        while (rooms.containsKey(roomId)) {
            roomId = "room-" + random.nextInt(MAX_ROOMS);
        }
        
        // Add both users to the room
        rooms.put(roomId, new CopyOnWriteArraySet<>(Set.of(userId, peerId)));
        userRooms.put(userId, roomId);
        userRooms.put(peerId, roomId);
        System.out.println(userRooms);
        synchronized(userRooms) {
        userRooms.notifyAll(); // Wake up any waiting threads
    }
        System.out.println("added " + userId + "and " + peerId +" in the room");
        
        // Remove both from lobby (they'll rejoin if call ends)
        lobbyUsers.remove(userId);
        lobbyUsers.remove(peerId);
        System.out.println("removing " + userId + "and " + peerId +" from the lobby");
        
        // Prepare headers for sending messages
        Map<String, Object> headers = new HashMap<>();
        headers.put("content-type", "application/json");
        headers.put("room-id", roomId);
        
        // Notify first user about room assignment
        messagingTemplate.convertAndSendToUser(
            userId,
            "/queue/private/room-assignment",
            new SignalingMessage("offerer", roomId, "server", userId),
            headers // Include headers
        );
        
        System.out.println("sent the signal to notify " + userId);

        // Notify second user about room assignment
        messagingTemplate.convertAndSendToUser(
            peerId,
            "/queue/private/room-assignment",
            new SignalingMessage("answerer", roomId, "server", peerId),
            headers // Include headers
        );
        
        System.out.println("sent the signal to notify " + peerId);

        System.out.println("Created room " + roomId + " for users " + userId + " and " + peerId);
    } else {
        // No available peers, just update lobby status
        broadcastLobbyUpdate("update", userId);
    }
}


    @MessageMapping("/end-call")
    public void handleEndCall(@Payload SignalingMessage message , SimpMessageHeaderAccessor headerAccessor) {
        if (!isValidMessage(message) || !StringUtils.hasText(message.getSender())) {
            return;
        }   

        System.out.println("trying to end the call ");

        String userId = message.getSender();
        String roomId = userRooms.get(userId);
        Map<String, Object> headers = new HashMap<>();
        headers.put("content-type", "application/json");
        headers.put("user-id", userId);    
        if (roomId != null) {
            // Notify peer about call ending
            Set<String> roomMembers = rooms.get(roomId);
            if (roomMembers != null) {
                for (String memberId : roomMembers) {
                    if (!memberId.equals(userId)) {
                        messagingTemplate.convertAndSendToUser(
                            memberId,
                            "/queue/private/call-ended",
                            new SignalingMessage("call-ended", "Peer disconnected", "server", memberId),
                            headers
                        );
                    }
                }
                
                // Clean up room
                rooms.remove(roomId);
                roomMembers.forEach(userRooms::remove);
            }
        }
        
        // Rejoin lobby
        handleJoin(message ,headerAccessor);
    }

    @MessageMapping("/signal/{roomId}")
    public void handleRoomSignal(@Payload SignalingMessage message,
                               @DestinationVariable String roomId) {
        if (!isValidMessage(message) || !StringUtils.hasText(message.getSender())) {
            return;
        }
        System.out.println("in the room  signal ");
        // Verify sender is in the room

        for (int i = 0; i < 3; i++) {
        if (userRooms.containsKey(message.getSender())) {
            break;
        }
        try { Thread.sleep(50); } catch (InterruptedException e) {}
    }
        System.out.println(userRooms.get(message.getSender()) + "\n\n\n\n\n");
        System.out.println(message.getSender());

        if (!userRooms.containsKey(message.getSender()) || 
            !roomId.equals(userRooms.get(message.getSender()))) {
            System.out.println("sender is not in the room");
        }



        // Forward to other user in the room
        Set<String> members = rooms.get(roomId);
        if (members != null) {
            for (String memberId : members) {
                System.out.println("member id : " + memberId + "/n/n" + "sender id :" + message.getSender());
                if (!memberId.equals(message.getSender())) {
                
                Map<String, Object> headers = new HashMap<>();
                headers.put("content-type", "application/json");
                headers.put("member-id", memberId);
                    System.out.println("sending the signal to " + memberId + " in room  " + roomId + "\n\n\n" );
                    messagingTemplate.convertAndSendToUser(
                        memberId,
                        "/queue/private/signal/",
                        message,headers
                    );
                }
            }
        }
    }

    @MessageMapping("/peer-info")
    public void handlePeerInfo(@Payload SignalingMessage message) {
        if (!isValidMessage(message) || !StringUtils.hasText(message.getSender())) {
            return;
        }

        String userId = message.getSender();
        
        // If user is in a room, send room info
        if (userRooms.containsKey(userId)) {
            String roomId = userRooms.get(userId);
            Set<String> members = rooms.get(roomId);
            Map<String, Object> headers = new HashMap<>();
        headers.put("content-type", "application/json");
        headers.put("members", members);
        
            if (members != null) {
                Set<String> peers = new CopyOnWriteArraySet<>(members);
                peers.remove(userId);
                
                messagingTemplate.convertAndSendToUser(
                    userId,
                    "/queue/private/room-info",
                    new SignalingMessage("room-info", peers, "server", userId)
                    ,headers
                );
            }
        } else {
            // Otherwise send lobby info
            sendLobbyInfoToUser(userId);
        }
    }

    private String findAvailablePeer(String requestingUserId) {
        return lobbyUsers.entrySet().stream()
            .filter(entry -> !entry.getKey().equals(requestingUserId))
            .filter(entry -> entry.getValue().isCallActive())
            .findFirst()
            .map(Map.Entry::getKey)
            .orElse(null);
    }

//     private void sendLobbyInfoToUser(String userId) {
//     Map<String, Boolean > lobbyStatus = new HashMap<>();
    
//     // Include ALL users (including self) but mark self differently
//     lobbyUsers.forEach((id, info) -> {
//         if (id.equals(userId)) {
//             lobbyStatus.put(id, null); // Special marker for self
//         } else {
//             lobbyStatus.put(id, info.isCallActive());
//         }
//     });
    
//     System.out.println("Sending lobby info to " + userId + ": " + lobbyStatus);
    
//     try {
//         messagingTemplate.convertAndSendToUser(
//             userId,
//             "/queue/private/lobby-info",
//             new SignalingMessage("lobby-info", lobbyStatus, "server", userId),msgHeader.createHeaders(userId)
//         );
//         System.out.println("sended the signal to " + userId);
//     } catch (Exception e) {
//         System.err.println("Failed to send lobby info to " + userId + ": " + e.getMessage());
//     }
// }

private void sendLobbyInfoToUser(String userId) {
    Map<String, Object> lobbyStatus = new HashMap<>();
    
    // Build the status object with proper structure
    lobbyUsers.forEach((id, info) -> {
        if (id.equals(userId)) {
            // For self, include additional metadata if needed
            Map<String, Object> selfInfo = new HashMap<>();
            selfInfo.put("isSelf", true);
            selfInfo.put("active", info.isCallActive());
            lobbyStatus.put(id, selfInfo);
        } else {
            // For others, include relevant information
            Map<String, Object> peerInfo = new HashMap<>();
            peerInfo.put("isSelf", false);
            peerInfo.put("active", info.isCallActive());
            peerInfo.put("lastActive", info.getLastActive());
            lobbyStatus.put(id, peerInfo);
        }
    });
    
    try {
        // Create the complete payload object
        Map<String, Object> payload = new HashMap<>();
        payload.put("type", "lobby-info");
        payload.put("data", lobbyStatus);
        payload.put("sender", "server");
        payload.put("recipient", userId);
        payload.put("timestamp", System.currentTimeMillis());
Map<String, Object> headers = new HashMap<>();
        headers.put("content-type", "application/json");
        headers.put("lobbyStatus", lobbyStatus);
        
        System.out.println("\n\n\n" + payload + "\n\n\n");
        // Send without custom headers (let Spring handle them)
        messagingTemplate.convertAndSendToUser(
            userId,
            "/queue/private/lobby-info",
            payload,
            headers
        );
        
        System.out.println("Successfully sent lobby info to " + userId + ": " + payload);
    } catch (Exception e) {
        System.err.println("Failed to send lobby info to " + userId + ": " + e.getMessage());
        e.printStackTrace();
    }
}
    private void broadcastLobbyUpdate(String type, String userId) {
        System.out.println("in the brodcast lobby ");
        lobbyUsers.keySet().forEach(id -> {
            if (!id.equals(userId)) {
                messagingTemplate.convertAndSendToUser(
                    id,
                    "/queue/private/lobby-update",
                    new SignalingMessage(type, userId, "server", id)
                );
                System.out.println("2");
            }
        });
    }

    private void removeUserFromSystem(String userId) {
        // Remove from room if in one
        String roomId = userRooms.get(userId);
        if (roomId != null) {
            Set<String> members = rooms.get(roomId);
            if (members != null) {
                members.remove(userId);
                
                // Notify other member about disconnection
                for (String memberId : members) {
                    messagingTemplate.convertAndSendToUser(
                        memberId,
                        "/queue/private/call-ended",
                        new SignalingMessage("call-ended", "Peer disconnected", "server", memberId)
                    );
                    userRooms.remove(memberId);
                }
                
                rooms.remove(roomId);
            }
            userRooms.remove(userId);
        }
        
        // Remove from lobby
        lobbyUsers.remove(userId);
        
        // Notify others about user leaving
        broadcastLobbyUpdate("leave", userId);
    }

    private boolean isValidMessage(SignalingMessage message) {
        if (message == null || !StringUtils.hasText(message.getType())) {
            return false;
        }

        return switch (message.getType()) {
            case "offer", "answer", "ice-candidate", "join", "leave", 
                 "peer-info", "room-info", "start-call", "end-call" -> true;
            default -> false;
        };
    }
}