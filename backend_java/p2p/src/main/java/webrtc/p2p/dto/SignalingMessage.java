package webrtc.p2p.dto;


import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class SignalingMessage {
    private String type; // "offer", "answer", "ice-candidate", "join"
    private Object data;
    private String sender;
    private String recipient;
}