// import { Client } from '@stomp/stompjs';
// import React, { useCallback, useEffect, useRef, useState } from 'react';
// import SockJS from 'sockjs-client';

// interface UserStatus {
//   [userId: string]: boolean | null; // true = call active
// }

// const VideoChat: React.FC = () => {
//   // State and ref declarations
//   const [onlineUsers, setOnlineUsers] = useState<UserStatus>({});
//   const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
//   const [error, setError] = useState<string | null>(null);
//   const [isCallActive, setIsCallActive] = useState(false);
//   const [isInRoom, setIsInRoom] = useState(false);
//   const [remotePeerId, setRemotePeerId] = useState<string | null>(null);
//   const [isConnecting, setIsConnecting] = useState(false);
//   const [connectionState, setConnectionState] = useState<string>('new');
//   // eslint-disable-next-line @typescript-eslint/no-unused-vars
//   const [signalingState, setSignalingState] = useState<string>('stable');

//   const currentRoomRef = useRef<string | null>(null);
//   const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
//   const localVideoRef = useRef<HTMLVideoElement>(null);
//   const remoteVideoRef = useRef<HTMLVideoElement>(null);
//   const localStreamRef = useRef<MediaStream | null>(null);
//   const clientIdRef = useRef<string>(crypto.randomUUID());
//   const stompClientRef = useRef<Client | null>(null);
//   const pendingIceCandidatesRef = useRef<RTCIceCandidate[]>([]);
//   const roleRef = useRef<string | null>(null);
//   // WebRTC Configuration
//   const ICE_CONFIG: RTCConfiguration = {
//     iceServers: [
//       { urls: 'stun:stun.l.google.com:19302' },
//       {
//         urls: 'turn:relay1.expressturn.com:3480',
//         username: '000000002065332507',
//         credential: '2dm9ltTqJIjVrRq/LI/QvTm0nPY='
//       }
//     ]
//   };

//   // Initialize local media stream
//   const initLocalStream = useCallback(async () => {
//     try {
//       const stream = await navigator.mediaDevices.getUserMedia({
//         video: true,
//         audio: true
//       });
//       localStreamRef.current = stream;
//       if (localVideoRef.current) {
//         localVideoRef.current.srcObject = stream;
//       }
//       return stream;
//     } catch (err) {
//       console.error('Failed to get local media stream:', err);
//       setError('Could not access camera/microphone');
//       return null;
//     }
//   }, []);

//   // Media cleanup
//   const cleanupMedia = useCallback(() => {
//     try {
//       localStreamRef.current?.getTracks().forEach(track => track.stop());
//       localStreamRef.current = null;
//       if (localVideoRef.current) localVideoRef.current.srcObject = null;
//       if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
//     } catch (error) {
//       console.error('Media cleanup error:', error);
//     }
//   }, []);

//   // Process pending ICE candidates
//   const processPendingIceCandidates = useCallback(async () => {
//     if (!peerConnectionRef.current) return;

//     const processed: number[] = [];
//     pendingIceCandidatesRef.current.forEach(async (candidate, index) => {
//       try {
//         await peerConnectionRef.current?.addIceCandidate(candidate);
//         processed.push(index);
//         console.log('Processed pending ICE candidate');
//       } catch (error) {
//         console.error('Error processing pending ICE candidate:', error);
//       }
//     });

//     // Remove processed candidates
//     pendingIceCandidatesRef.current = pendingIceCandidatesRef.current.filter((_, i) => !processed.includes(i));
//   }, []);

//   // Reset connection
//   const resetConnection = useCallback(() => {
//     try {
//       setIsCallActive(false);
//       setIsInRoom(false);
//       currentRoomRef.current = null;
//       setRemotePeerId(null);
//       setIsConnecting(false);
//       setConnectionState('closed');
//       setSignalingState('closed');
//       pendingIceCandidatesRef.current = [];
      
//       if (peerConnectionRef.current) {
//         peerConnectionRef.current.close();
//         peerConnectionRef.current = null;
//       }
      
//       cleanupMedia();
      
//       // Notify server we're ending the call
//       if (stompClientRef.current?.connected) {
//         stompClientRef.current.publish({
//           destination: '/app/end-call',
//           body: JSON.stringify({
//             type: 'end-call',
//             sender: clientIdRef.current
//           })
//         });
//       }
//     } catch (error) {
//       console.error('Connection reset error:', error);
//     }
//   }, [cleanupMedia]);

//   // Create peer connection
//   const createPeerConnection = useCallback(async () => {
//     try {
//       const pc = new RTCPeerConnection(ICE_CONFIG);
//       console.log("Creating new peer connection");
      
//       pc.onicecandidate = (event) => {
//         if (event.candidate && stompClientRef.current?.connected && currentRoomRef.current) {
//           stompClientRef.current.publish({
//             destination: `/app/signal/${currentRoomRef.current}`,
//             body: JSON.stringify({
//               type: 'ice-candidate',
//               data: event.candidate.toJSON(),
//               sender: clientIdRef.current
//             })
//           });
//           console.log("Sent ICE candidate");
//         }
//       };
//       console.log("adding remote stream ");
//       pc.ontrack = (event) => {
//         if (remoteVideoRef.current && event.streams[0]) {
//           remoteVideoRef.current.srcObject = event.streams[0];
//           setIsCallActive(true);
//           setIsConnecting(false);
//         }
//       };

//       pc.onconnectionstatechange = () => {
//         setConnectionState(pc.connectionState);
//         switch (pc.connectionState) {
//           case 'connected':
//             setIsCallActive(true);
//             setIsConnecting(false);
//             break;
//           case 'disconnected':
//           case 'failed':
//           case 'closed':
//             resetConnection();
//             break;
//         }
//       };

//       pc.onsignalingstatechange = () => {
//         console.log('Signaling state changed to:', pc.signalingState);
//         setSignalingState(pc.signalingState);
//         if (pc.signalingState === 'stable') {
//           processPendingIceCandidates();
//         }
//       };

//       // Add local stream tracks to the connection
//       if (localStreamRef.current) {
//         localStreamRef.current.getTracks().forEach(track => {
//           pc.addTrack(track, localStreamRef.current!);
//         });
//       } else {
//         const stream = await initLocalStream();
//         if (stream) {
//           stream.getTracks().forEach(track => {
//             pc.addTrack(track, stream);
//           });
//         }
//       }

//       return pc;
//     } catch (error) {
//       console.error('Peer connection creation error:', error);
//       setError('Failed to create peer connection');
//       return null;
//     }
//   }, [initLocalStream, resetConnection, processPendingIceCandidates]);

//   // Handle remote offer
//   const handleRemoteOffer = useCallback(async (offer: RTCSessionDescriptionInit, sender: string) => {
//     try {
//       if (!stompClientRef.current?.connected || !currentRoomRef.current) {
//         throw new Error('Not connected to signaling server or no room assigned');
//       }

//       // Clean up any existing connection first
//       if (peerConnectionRef.current) {
//         peerConnectionRef.current.close();
//         peerConnectionRef.current = null;
//       }
      
//       setRemotePeerId(sender);
      
//       const pc = await createPeerConnection();
//       if (!pc) {
//         throw new Error('Failed to create peer connection');
//       }
//       peerConnectionRef.current = pc;

//       // Set remote description first
//       await pc.setRemoteDescription(new RTCSessionDescription(offer));
//       console.log("Remote description set");

//       // Process any pending ICE candidates that arrived early
//       await processPendingIceCandidates();

//       // Then create and set local description
//       const answer = await pc.createAnswer();
//       await pc.setLocalDescription(answer);
//       console.log("Answer created and local description set");

//       stompClientRef.current.publish({
//         destination: `/app/signal/${currentRoomRef.current}`,
//         body: JSON.stringify({
//           type: 'answer',
//           data: answer,
//           sender: clientIdRef.current
//         })
//       });
//     } catch (error) {
//       console.error('Offer handling error:', error);
//       setError(`Failed to handle offer: ${error instanceof Error ? error.message : 'Unknown error'}`);
//       resetConnection();
//     }
//   }, [createPeerConnection, resetConnection, processPendingIceCandidates]);

//   // Handle signaling messages
//   // eslint-disable-next-line @typescript-eslint/no-explicit-any
//   const handleSignalingMessage = useCallback(async (message: any) => {
//     try {
//       console.log('Received message:', message);

//       switch (message.type) {
//         case 'lobby-status':
//           setOnlineUsers(message.data);
//           break;

//         case 'lobby-info':
//           { const lobbyData = message.data as { [userId: string]: boolean | null };
//           const processedData: UserStatus = {};
//           Object.entries(lobbyData).forEach(([userId, status]) => {
//             processedData[userId] = status;
//           });
//           setOnlineUsers(processedData);
//           break; }

//         case 'join':
//           if (message.data === clientIdRef.current) break;
//           setOnlineUsers(prev => ({ ...prev, [message.data]: false }));
//           break;

//         case 'leave':
//           if (message.data === clientIdRef.current) break;
//           setOnlineUsers(prev => {
//             const newStatus = {...prev};
//             delete newStatus[message.data];
//             return newStatus;
//           });
//           break;

//         case 'update':
//           if (message.data === clientIdRef.current) break;
//           setOnlineUsers(prev => {
//             if (prev[message.data] !== undefined) {
//               return {...prev, [message.data]: true};
//             }
//             return prev;
//           });
//           break;
          
//         case 'offerer':
//           currentRoomRef.current = message.data;
//           roleRef.current = message.type;
//           setIsInRoom(true);
//           setIsConnecting(true);
//           break;

//           case 'answerer':
//           currentRoomRef.current = message.data;
//           roleRef.current = message.type;
//           setIsInRoom(true);
//           setIsConnecting(true);
//           break;
          
//         case 'call-ended':
//           setError('Call ended: ' + message.data);
//           resetConnection();
//           break;
          
//         case 'offer':
//           await handleRemoteOffer(message.data, message.sender);
//           break;
          
//         case 'answer':
//           if (!peerConnectionRef.current) {
//             console.error('No peer connection when answer received');
//             return;
//           }
//           setRemotePeerId(message.sender);
//           console.log('Current signaling state:', peerConnectionRef.current.signalingState);
          
//           if (peerConnectionRef.current.signalingState === 'have-local-offer') {
//             try {
//               await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(message.data));
//               console.log('Successfully set remote answer');
//             } catch (error) {
//               console.error('Failed to set remote answer:', error);
//               resetConnection();
//             }
//           } else {
//             console.warn(`Received answer in unexpected state: ${peerConnectionRef.current.signalingState}`);
//           }
//           break;
          
//         case 'ice-candidate':
//           if (!peerConnectionRef.current) {
//             console.warn('Received ICE candidate but no peer connection exists');
//             return;
//           }

//           try {
//             const candidate = new RTCIceCandidate(message.data);
            
//             // Check if remote description is set
//             if (peerConnectionRef.current.remoteDescription) {
//               await peerConnectionRef.current.addIceCandidate(candidate);

//               console.log('Successfully added ICE candidate');
//               console.log(peerConnectionRef.current.iceConnectionState)
//             } else {
//               // Queue the candidate if remote description isn't set yet
//               console.log('Queueing ICE candidate - remote description not set');
//               pendingIceCandidatesRef.current.push(candidate);
//             }
//           } catch (error) {
//             console.error('Error adding ICE candidate:', error);
//           }
//           break;
//       }
//     } catch (error) {
//       console.error('Error handling message:', error);
//       setError(`Failed to handle ${message.type} message`);
//     }
//   }, [handleRemoteOffer, resetConnection]);

//   // Start call with a peer
//   const startCall = useCallback(async () => {
//     try {
//       if (!stompClientRef.current?.connected) {
//         throw new Error('Not connected to signaling server');
//       }

//       if (!localStreamRef.current) {
//         await initLocalStream();
//       }

//       stompClientRef.current.publish({
//         destination: '/app/start-call',
//         body: JSON.stringify({
//           type: 'start-call',
//           sender: clientIdRef.current
//         })
//       });
      
//       setIsConnecting(true);
//     } catch (error) {
//       console.error('Call start error:', error);
//       setError(`Failed to start call: ${error instanceof Error ? error.message : 'Unknown error'}`);
//       resetConnection();
//     }
//   }, [initLocalStream, resetConnection]);

//   // Initialize WebSocket connection
//   useEffect(() => {
//     const client = new Client({
//       webSocketFactory: () => new SockJS('http://localhost:8080/ws'),
//       reconnectDelay: 5000,
//       heartbeatIncoming: 4000,
//       heartbeatOutgoing: 4000,
//       debug: (str) => console.log('STOMP:', str),
      
//           onConnect: () => {
//         setConnectionStatus('connected');
//         console.log("hello ");
        
//         // Subscribe to all channels
//         client.subscribe('/topic/lobby-status', (message) => 
//           handleSignalingMessage(JSON.parse(message.body)));
          
//         client.subscribe('/user/'+ clientIdRef.current + '/queue/private/lobby-info', (message) => 
//           handleSignalingMessage(JSON.parse(message.body)));
          
//         client.subscribe('/user/'+ clientIdRef.current +'/queue/private/lobby-update', (message) => 
//           handleSignalingMessage(JSON.parse(message.body)));
          
//         client.subscribe('/user/' + clientIdRef.current +'/queue/private/room-assignment', (message) => 
//           handleSignalingMessage(JSON.parse(message.body)));
          
//         client.subscribe('/user/'+ clientIdRef.current +'/queue/private/call-ended', (message) => 
//           handleSignalingMessage(JSON.parse(message.body)));
          
//         // Send join message
//         client.publish({
//           destination: '/app/join',
//           body: JSON.stringify({
//             type: 'join',
//             sender: clientIdRef.current
//           })
//         });

//         client.subscribe('/user/'+ clientIdRef.current +'/queue/private/signal/', (message) => 
//           handleSignalingMessage(JSON.parse(message.body)));
        
//       },

      
//       onDisconnect: () => {
//         setConnectionStatus('disconnected');
//         resetConnection();
//       },
      
//       onStompError: (frame) => {
//         setError(frame.headers?.message || 'WebSocket error');
//       }
//     });

//     stompClientRef.current = client;
//     setConnectionStatus('connecting');
//     client.activate();

//     initLocalStream();

//     return () => {
//       client.deactivate();
//       resetConnection();
//     };
//   }, [handleSignalingMessage, resetConnection, initLocalStream]);

//   // Create offer when room is assigned
//   useEffect(() => {
//     if (!isInRoom || !currentRoomRef.current) return;

//     const createOffer = async () => {
//       try {
//         const pc = await createPeerConnection();
//         if (!pc) {
//           throw new Error('Failed to create peer connection');
//         }
//         peerConnectionRef.current = pc;

//         const offer = await pc.createOffer({
//           offerToReceiveAudio: true,
//           offerToReceiveVideo: true
//         });

//         await pc.setLocalDescription(offer);
//         console.log("Offer created and local description set");

//         stompClientRef.current?.publish({ 
//           destination: `/app/signal/${currentRoomRef.current}`,
//           body: JSON.stringify({
//             type: 'offer',
//             data: offer,
//             sender: clientIdRef.current
//           })
//         });
//       } catch (error) {
//         console.error('Offer creation error:', error);
//         setError(`Failed to create offer: ${error instanceof Error ? error.message : 'Unknown error'}`);
//         resetConnection();
//       }
//     };
//     if(roleRef.current === 'offerer')
//     {
//       createOffer();
//     }

//   }, [isInRoom, createPeerConnection, resetConnection]);

//   // Render method remains the same as your original
//   return (
//     <div className="webrtc-container">
//       <div className="video-container">
//         <div className="video-wrapper">
//           <h3>Local Stream</h3>
//           <video
//             ref={localVideoRef}
//             autoPlay
//             muted
//             playsInline
//             className="video-element"
//           />
//         </div>
//         <div className="video-wrapper">
//           <h3>Remote Stream</h3>
//           {isConnecting ? (
//             <div className="connecting-loader">
//               <div className="spinner"></div>
//               <p>Connecting to peer...</p>
//             </div>
//           ) : (
//             <video
//               ref={remoteVideoRef}
//               autoPlay
//               playsInline
//               className="video-element"
//             />
//           )}
//         </div>
//       </div>
     
//       <div className="status-container">
//         <div>Connection Status: <span className={connectionStatus}>{connectionStatus}</span></div>
//         <div>Client ID: {clientIdRef.current}</div>
//         <div>Peer Connection State: {connectionState}</div>
//         <div>Online Users: {Object.keys(onlineUsers).length}</div>
//         <div>Current Room: {currentRoomRef.current || 'Not in a room'}</div>

//         <div>
//           Remote Peer: {remotePeerId || 'None'}</div>
//         {error && (
//           <div className="error-message">
//             Error: {error}
//             <button onClick={() => setError(null)}>Dismiss</button>
//           </div>
//         )}
//       </div>
     
//       <div className="controls">
//         <button
//           onClick={startCall}
//           disabled={isCallActive || connectionStatus !== 'connected' || Object.keys(onlineUsers).length === 0}
//           className="control-button"
//         >
//           Start Call
//         </button>
//         <button
//           onClick={resetConnection}
//           disabled={!isCallActive}
//           className="control-button end-call"
//         >
//           End Call
//         </button>
//       </div>
      
//       <div className="user-list">
//         <h3>Online Users ({Object.keys(onlineUsers).length})</h3>
//         <ul>
//           {Object.entries(onlineUsers).map(([userId, status]) => (
//             <li key={userId}>
//               {userId === clientIdRef.current 
//                 ? "You" 
//                 : userId
//               } 
//               {status === null 
//                 ? " (You)" 
//                 : status 
//                   ? " (In Call)" 
//                   : " (Available)"
//               }
//             </li>
//           ))}
//         </ul>
//       </div>
//     </div>
//   );
// };

// export default VideoChat;


import { Client } from '@stomp/stompjs';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import SockJS from 'sockjs-client';

interface UserStatus {
  [userId: string]: boolean | null; // true = call active
}

const VideoChat: React.FC = () => {
  // State and ref declarations
  const [onlineUsers, setOnlineUsers] = useState<UserStatus>({});
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [isCallActive, setIsCallActive] = useState(false);
  const [isInRoom, setIsInRoom] = useState(false);
  const [remotePeerId, setRemotePeerId] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionState, setConnectionState] = useState<string>('new');
  const [iceConnectionState, setIceConnectionState] = useState<string>('new'); // Added ICE connection state
  const [signalingState, setSignalingState] = useState<string>('stable');

  const currentRoomRef = useRef<string | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const clientIdRef = useRef<string>(crypto.randomUUID());
  const stompClientRef = useRef<Client | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidate[]>([]);
  const roleRef = useRef<string | null>(null);

  // WebRTC Configuration
  const ICE_CONFIG: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: 'turn:relay1.expressturn.com:3480',
        username: '000000002065332507',
        credential: '2dm9ltTqJIjVrRq/LI/QvTm0nPY='
      }
    ]
  };

  const waitForRemoteVideoRef = () => {
    return new Promise<HTMLVideoElement>((resolve, reject) => {
      const checkInterval = setInterval(() => {
        if (remoteVideoRef.current) {
          clearInterval(checkInterval);
          resolve(remoteVideoRef.current);
        }
      }, 100);

      // Timeout after 5 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Remote video ref not set'));
      }, 5000);
    });
  };


  // Initialize local media stream
  const initLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      console.log('Local stream initialized successfully');
      return stream;
    } catch (err) {
      console.error('Failed to get local media stream:', err);
      setError('Could not access camera/microphone');
      return null;
    }
  }, []);

  // Media cleanup
  const cleanupMedia = useCallback(() => {
    try {
      localStreamRef.current?.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      console.log('Media cleanup completed');
    } catch (error) {
      console.error('Media cleanup error:', error);
    }
  }, []);

  // Process pending ICE candidates
  const processPendingIceCandidates = useCallback(async () => {
    if (!peerConnectionRef.current) return;

    console.log(`Processing ${pendingIceCandidatesRef.current.length} pending ICE candidates`);
    const processed: number[] = [];
    
    for (let i = 0; i < pendingIceCandidatesRef.current.length; i++) {
      const candidate = pendingIceCandidatesRef.current[i];
      try {
        await peerConnectionRef.current.addIceCandidate(candidate);
        processed.push(i);
        console.log('Processed pending ICE candidate:', candidate);
      } catch (error) {
        console.error('Error processing pending ICE candidate:', error);
      }
    }

    // Remove processed candidates
    pendingIceCandidatesRef.current = pendingIceCandidatesRef.current.filter((_, i) => !processed.includes(i));
  }, []);

  // Reset connection
  const resetConnection = useCallback(() => {
    try {
      console.log('Resetting connection...');
      setIsCallActive(false);
      setIsInRoom(false);
      currentRoomRef.current = null;
      setRemotePeerId(null);
      setIsConnecting(false);
      setConnectionState('closed');
      setIceConnectionState('closed');
      setSignalingState('closed');
      pendingIceCandidatesRef.current = [];
      
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      
      cleanupMedia();
      
      // Notify server we're ending the call
      if (stompClientRef.current?.connected) {
        stompClientRef.current.publish({
          destination: '/app/end-call',
          body: JSON.stringify({
            type: 'end-call',
            sender: clientIdRef.current
          })
        });
      }
    } catch (error) {
      console.error('Connection reset error:', error);
    }
  }, [cleanupMedia]);

  // Create peer connection
  const createPeerConnection = useCallback(async () => {
    try {
      const pc = new RTCPeerConnection(ICE_CONFIG);
      console.log("Creating new peer connection");
      
      // ICE candidate handler
      pc.onicecandidate = (event) => {
        if (event.candidate && stompClientRef.current?.connected && currentRoomRef.current) {
          console.log("Sending ICE candidate:", event.candidate);
          stompClientRef.current.publish({
            destination: `/app/signal/${currentRoomRef.current}`,
            body: JSON.stringify({
              type: 'ice-candidate',
              data: event.candidate.toJSON(),
              sender: clientIdRef.current
            })
          });
        } else if (!event.candidate) {
          console.log("ICE gathering completed");
        }
      };

      // // Track handler - IMPROVED
      // pc.ontrack = (event) => {
      //   console.log("Received remote track:", event);
      //   console.log("Streams received:", event.streams);
        
      //   if (event.streams && event.streams[0]) {
      //     const remoteStream = event.streams[0];
      //     console.log("Remote stream tracks:", remoteStream.getTracks());
      //     console.log(remoteVideoRef.current);
      //     // Ensure remote video element exists
      //     if (remoteVideoRef.current) {
      //       remoteVideoRef.current.srcObject = remoteStream;
      //       console.log("Remote stream assigned to video element");
            
      //       // Add event listeners to debug video element
      //       const remoteVideo = remoteVideoRef.current;
      //       remoteVideo.onloadedmetadata = () => {
      //         console.log("Remote video metadata loaded");
      //         remoteVideo.play().catch(e => console.error("Error playing remote video:", e));
            
      //       remoteVideo.oncanplay = () => console.log("Remote video can play");
      //       remoteVideo.onplaying = () => console.log("Remote video is playing");
      //       remoteVideo.onerror = (e) => console.error("Remote video error:", e);
            
      //       setIsCallActive(true);
      //       setIsConnecting(false);
      //     }
      //   }else {
      //       console.error("Remote video element not found");
      //     }
      //   } else {
      //     console.warn("No streams in track event");
      //   }
      // };

      pc.ontrack = async (event) => {
  console.log("Received remote track:", event);
  console.log("Streams received:", event.streams);
 
  if (event.streams && event.streams[0]) {
    const remoteStream = event.streams[0];
    console.log("Remote stream tracks:", remoteStream.getTracks());
    
    try {
      // Wait for the video element to be available
      const remoteVideo = await waitForRemoteVideoRef();
      console.log("Remote video element is now available:", remoteVideo);
      
      // Assign the stream
      remoteVideo.srcObject = remoteStream;
      console.log("Remote stream assigned to video element");
      
      // Add event listeners
      remoteVideo.onloadedmetadata = () => {
        console.log("Remote video metadata loaded");
        remoteVideo.play().catch(e => console.error("Error playing remote video:", e));
      };
      remoteVideo.oncanplay = () => console.log("Remote video can play");
      remoteVideo.onplaying = () => console.log("Remote video is playing");
      remoteVideo.onerror = (e) => console.error("Remote video error:", e);
      
      setIsCallActive(true);
      setIsConnecting(false);
      
    } catch (error) {
      const er = error as Error;
      console.error("Failed to get remote video element:", er.message);
      // Handle the timeout case
    }
  } else {
    console.warn("No streams in track event");
  }
};

      // Connection state change handler - IMPROVED
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        console.log('Connection state changed to:', state);
        setConnectionState(state);
        
        switch (state) {
          case 'connected':
            console.log('Peer connection established successfully');
            setIsCallActive(true);
            setIsConnecting(false);
            break;
          case 'disconnected':
            console.log('Peer connection disconnected');
            break;
          case 'failed':
            console.log('Peer connection failed');
            resetConnection();
            break;
          case 'closed':
            console.log('Peer connection closed');
            resetConnection();
            break;
        }
      };

      // ICE connection state change handler - NEW
      pc.oniceconnectionstatechange = () => {
        const iceState = pc.iceConnectionState;
        console.log('ICE connection state changed to:', iceState);
        setIceConnectionState(iceState);
        
        switch (iceState) {
          case 'connected':
          case 'completed':
            console.log('ICE connection established - media should flow now');
            break;
          case 'disconnected':
            console.log('ICE connection lost');
            break;
          case 'failed':
            console.log('ICE connection failed');
            setError('Connection failed - please try again');
            break;
        }
      };

      // Signaling state change handler
      pc.onsignalingstatechange = () => {
        const sigState = pc.signalingState;
        console.log('Signaling state changed to:', sigState);
        setSignalingState(sigState);
        
        if (sigState === 'stable') {
          console.log('Signaling stable - processing pending ICE candidates');
          processPendingIceCandidates();
        }
      };
      console.log(localStreamRef.current);
      // Add local stream tracks to the connection
      if (localStreamRef.current) {
        console.log('Adding local stream tracks to peer connection');
        localStreamRef.current.getTracks().forEach(track => {
          console.log('Adding track:', track.kind, track.label);
          pc.addTrack(track, localStreamRef.current!);
        });
      } else {
        console.log('Initializing local stream before adding tracks');
        const stream = await initLocalStream();
        if (stream) {
          stream.getTracks().forEach(track => {
            console.log('Adding track:', track.kind, track.label);
            pc.addTrack(track, stream);
          });
        }
      }

      return pc;
    } catch (error) {
      console.error('Peer connection creation error:', error);
      setError('Failed to create peer connection');
      return null;
    }
  }, [initLocalStream, resetConnection, processPendingIceCandidates]);

  // Handle remote offer
  const handleRemoteOffer = useCallback(async (offer: RTCSessionDescriptionInit, sender: string) => {
    try {
      console.log('Handling remote offer from:', sender);
      
      if (!stompClientRef.current?.connected || !currentRoomRef.current) {
        throw new Error('Not connected to signaling server or no room assigned');
      }

      // Clean up any existing connection first
      if (peerConnectionRef.current) {
        console.log('Closing existing peer connection');
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      
      setRemotePeerId(sender);
      
      const pc = await createPeerConnection();
      if (!pc) {
        throw new Error('Failed to create peer connection');
      }
      peerConnectionRef.current = pc;

      // Set remote description first
      console.log('Setting remote description (offer)');
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      console.log("Remote description set successfully");

      // Process any pending ICE candidates that arrived early
      await processPendingIceCandidates();

      // Then create and set local description
      console.log('Creating answer...');
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log("Answer created and local description set");

      // Send answer
      stompClientRef.current.publish({
        destination: `/app/signal/${currentRoomRef.current}`,
        body: JSON.stringify({
          type: 'answer',
          data: answer,
          sender: clientIdRef.current
        })
      });
      console.log('Answer sent');
      
    } catch (error) {
      console.error('Offer handling error:', error);
      setError(`Failed to handle offer: ${error instanceof Error ? error.message : 'Unknown error'}`);
      resetConnection();
    }
  }, [createPeerConnection, resetConnection, processPendingIceCandidates]);

  // Handle signaling messages
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSignalingMessage = useCallback(async (message: any) => {
    try {
      console.log('Received message:', message.type, message);

      switch (message.type) {
        case 'lobby-status':
          setOnlineUsers(message.data);
          break;

        case 'lobby-info':
          { const lobbyData = message.data as { [userId: string]: boolean | null };
          const processedData: UserStatus = {};
          Object.entries(lobbyData).forEach(([userId, status]) => {
            processedData[userId] = status;
          });
          setOnlineUsers(processedData);
          break; }

        case 'join':
          if (message.data === clientIdRef.current) break;
          setOnlineUsers(prev => ({ ...prev, [message.data]: false }));
          break;

        case 'leave':
          if (message.data === clientIdRef.current) break;
          setOnlineUsers(prev => {
            const newStatus = {...prev};
            delete newStatus[message.data];
            return newStatus;
          });
          break;

        case 'update':
          if (message.data === clientIdRef.current) break;
          setOnlineUsers(prev => {
            if (prev[message.data] !== undefined) {
              return {...prev, [message.data]: true};
            }
            return prev;
          });
          break;
          
        case 'offerer':
          console.log('Assigned as offerer for room:', message.data);
          currentRoomRef.current = message.data;
          roleRef.current = message.type;
          setIsInRoom(true);
          setIsConnecting(true);
          break;

        case 'answerer':
          console.log('Assigned as answerer for room:', message.data);
          currentRoomRef.current = message.data;
          roleRef.current = message.type;
          setIsInRoom(true);
          setIsConnecting(true);
          break;
          
        case 'call-ended':
          console.log('Call ended:', message.data);
          setError('Call ended: ' + message.data);
          resetConnection();
          break;
          
        case 'offer':
          console.log('Received offer from:', message.sender);
          await handleRemoteOffer(message.data, message.sender);
          break;
          
        case 'answer':
          console.log('Received answer from:', message.sender);
          if (!peerConnectionRef.current) {
            console.error('No peer connection when answer received');
            return;
          }
          setRemotePeerId(message.sender);
          console.log('Current signaling state:', peerConnectionRef.current.signalingState);
          
          if (peerConnectionRef.current.signalingState === 'have-local-offer') {
            try {
              await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(message.data));
              console.log('Successfully set remote answer');
            } catch (error) {
              console.error('Failed to set remote answer:', error);
              resetConnection();
            }
          } else {
            console.warn(`Received answer in unexpected state: ${peerConnectionRef.current.signalingState}`);
          }
          break;
          
        case 'ice-candidate':
          console.log('Received ICE candidate from:', message.sender);
          if (!peerConnectionRef.current) {
            console.warn('Received ICE candidate but no peer connection exists');
            return;
          }

          try {
            const candidate = new RTCIceCandidate(message.data);
            console.log('ICE candidate:', candidate);
            
            // Check if remote description is set
            if (peerConnectionRef.current.remoteDescription) {
              await peerConnectionRef.current.addIceCandidate(candidate);
              console.log('Successfully added ICE candidate');
              console.log('ICE connection state:', peerConnectionRef.current.iceConnectionState);
            } else {
              // Queue the candidate if remote description isn't set yet
              console.log('Queueing ICE candidate - remote description not set');
              pendingIceCandidatesRef.current.push(candidate);
            }
          } catch (error) {
            console.error('Error adding ICE candidate:', error);
          }
          break;
      }
    } catch (error) {
      console.error('Error handling message:', error);
      setError(`Failed to handle ${message.type} message`);
    }
  }, [handleRemoteOffer, resetConnection]);

  // Start call with a peer
  const startCall = useCallback(async () => {
    try {
      console.log('Starting call...');
      if (!stompClientRef.current?.connected) {
        throw new Error('Not connected to signaling server');
      }

      if (!localStreamRef.current) {
        console.log('Initializing local stream...');
        await initLocalStream();
      }

      stompClientRef.current.publish({
        destination: '/app/start-call',
        body: JSON.stringify({
          type: 'start-call',
          sender: clientIdRef.current
        })
      });
      
      setIsConnecting(true);
      console.log('Call start request sent');
    } catch (error) {
      console.error('Call start error:', error);
      setError(`Failed to start call: ${error instanceof Error ? error.message : 'Unknown error'}`);
      resetConnection();
    }
  }, [initLocalStream, resetConnection]);

  // Initialize WebSocket connection
  useEffect(() => {
    const client = new Client({
      webSocketFactory: () => new SockJS('http://localhost:8080/ws'),
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
      debug: (str) => console.log('STOMP:', str),
      
      onConnect: () => {
        console.log("WebSocket connected successfully");
        setConnectionStatus('connected');
        
        // Subscribe to all channels
        client.subscribe('/topic/lobby-status', (message) => 
          handleSignalingMessage(JSON.parse(message.body)));
          
        client.subscribe('/user/'+ clientIdRef.current + '/queue/private/lobby-info', (message) => 
          handleSignalingMessage(JSON.parse(message.body)));
          
        client.subscribe('/user/'+ clientIdRef.current +'/queue/private/lobby-update', (message) => 
          handleSignalingMessage(JSON.parse(message.body)));
          
        client.subscribe('/user/' + clientIdRef.current +'/queue/private/room-assignment', (message) => 
          handleSignalingMessage(JSON.parse(message.body)));
          
        client.subscribe('/user/'+ clientIdRef.current +'/queue/private/call-ended', (message) => 
          handleSignalingMessage(JSON.parse(message.body)));

        client.subscribe('/user/'+ clientIdRef.current +'/queue/private/signal/', (message) => 
          handleSignalingMessage(JSON.parse(message.body)));
        
        // Send join message
        client.publish({
          destination: '/app/join',
          body: JSON.stringify({
            type: 'join',
            sender: clientIdRef.current
          })
        });
      },
      
      onDisconnect: () => {
        console.log("WebSocket disconnected");
        setConnectionStatus('disconnected');
        resetConnection();
      },
      
      onStompError: (frame) => {
        console.error('STOMP error:', frame);
        setError(frame.headers?.message || 'WebSocket error');
      }
    });

    stompClientRef.current = client;
    setConnectionStatus('connecting');
    client.activate();

    initLocalStream();

    return () => {
      console.log('Cleaning up WebSocket connection');
      client.deactivate();
      resetConnection();
    };
  }, [handleSignalingMessage, resetConnection, initLocalStream]);

  // Create offer when room is assigned
  useEffect(() => {
    if (!isInRoom || !currentRoomRef.current || roleRef.current !== 'offerer') return;

    const createOffer = async () => {
      try {
        console.log('Creating offer for room:', currentRoomRef.current);
        const pc = await createPeerConnection();
        if (!pc) {
          throw new Error('Failed to create peer connection');
        }
        peerConnectionRef.current = pc;

        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });

        await pc.setLocalDescription(offer);
        console.log("Offer created and local description set");

        stompClientRef.current?.publish({ 
          destination: `/app/signal/${currentRoomRef.current}`,
          body: JSON.stringify({
            type: 'offer',
            data: offer,
            sender: clientIdRef.current
          })
        });
        console.log('Offer sent');
      } catch (error) {
        console.error('Offer creation error:', error);
        setError(`Failed to create offer: ${error instanceof Error ? error.message : 'Unknown error'}`);
        resetConnection();
      }
    };

    createOffer();
  }, [isInRoom, createPeerConnection, resetConnection]);

  // Render method with improved status display
  return (
    <div className="webrtc-container">
      <div className="video-container">
        <div className="video-wrapper">
          <h3>Local Stream</h3>
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="video-element"
            style={{ width: '300px', height: '200px', backgroundColor: '#000' }}
          />
        </div>
        <div className="video-wrapper">
          <h3>Remote Stream</h3>
          {isConnecting ? (
            <div className="connecting-loader">
              <div className="spinner"></div>
              <p>Connecting to peer...</p>
            </div>
          ) : (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="video-element"
              style={{ width: '300px', height: '200px', backgroundColor: '#000' }}
            />
          )}
        </div>
      </div>
     
      <div className="status-container">
        <div>Connection Status: <span className={connectionStatus}>{connectionStatus}</span></div>
        <div>Client ID: {clientIdRef.current}</div>
        <div>Peer Connection State: {connectionState}</div>
        <div>ICE Connection State: {iceConnectionState}</div>
        <div>Signaling State: {signalingState}</div>
        <div>Online Users: {Object.keys(onlineUsers).length}</div>
        <div>Current Room: {currentRoomRef.current || 'Not in a room'}</div>
        <div>Role: {roleRef.current || 'None'}</div>
        <div>Remote Peer: {remotePeerId || 'None'}</div>
        {error && (
          <div className="error-message">
            Error: {error}
            <button onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}
      </div>
     
      <div className="controls">
        <button
          onClick={startCall}
          disabled={isCallActive || connectionStatus !== 'connected' || Object.keys(onlineUsers).length === 0}
          className="control-button"
        >
          Start Call
        </button>
        <button
          onClick={resetConnection}
          disabled={!isCallActive && !isConnecting}
          className="control-button end-call"
        >
          End Call
        </button>
      </div>
      
      <div className="user-list">
        <h3>Online Users ({Object.keys(onlineUsers).length})</h3>
        <ul>
          {Object.entries(onlineUsers).map(([userId, status]) => (
            <li key={userId}>
              {userId === clientIdRef.current 
                ? "You" 
                : userId
              } 
              {status === null 
                ? " (You)" 
                : status 
                  ? " (In Call)" 
                  : " (Available)"
              }
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default VideoChat;