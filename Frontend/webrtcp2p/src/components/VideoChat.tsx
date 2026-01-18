import { Client } from '@stomp/stompjs';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import SockJS from 'sockjs-client';

import { MessageCircle, Mic, MicOff, PhoneOff, Send, SkipForward, Video, Video as VideoIcon, VideoOff } from 'lucide-react';
import styles from './VideoChatModern.module.css';

interface ChatMessage {
  id: string;
  sender: string;
  message: string;
  timestamp: Date;
  isSelf: boolean;
}

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

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    if (chatContainerRef.current)
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
  }, [chatMessages]);

  // WebRTC Configurationa
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

      // Clear chat messages when call ends
      setChatMessages([]);
      setChatInput('');

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

        initLocalStream();
      }
    } catch (error) {
      console.error('Connection reset error:', error);
    }
  }, [cleanupMedia, initLocalStream]);

  // Clear error message after a few seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError(null);
      }, 3000); // Clear after 3 seconds

      return () => clearTimeout(timer);
    }
  }, [error]);

  // Next button handler - reset connection and start new call
  const handleNextCall = useCallback(async () => {
    try {
      console.log('Starting next call...');

      // Clear any existing error
      setError(null);

      // Reset connection first
      resetConnection();

      // Wait a moment for cleanup, then start new call
      const startNewCall = async () => {
        try {
          if (!stompClientRef.current?.connected) {
            throw new Error('Not connected to signaling server');
          }

          if (!localStreamRef.current) {
            console.log('Initializing local stream...');
            await initLocalStream();
          }

          // Clear chat messages when starting a new call
          setChatMessages([]);
          setChatInput('');

          stompClientRef.current.publish({
            destination: '/app/start-call',
            body: JSON.stringify({
              type: 'start-call',
              sender: clientIdRef.current
            })
          });

          setIsConnecting(true);
          console.log('Next call start request sent');
        } catch (error) {
          console.error('Error in startNewCall:', error);
          setError(`Failed to start next call: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      };

      // Use setTimeout to ensure cleanup is complete
      setTimeout(startNewCall, 500);
    } catch (error) {
      console.error('Next call error:', error);
      setError(`Failed to start next call: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [resetConnection, initLocalStream]);

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
          }
        } else {
          console.warn("No streams in track event");
        }
      };

      // Connection state change handler
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

      // ICE connection state change handler
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
          {
            const lobbyData = message.data as { [userId: string]: boolean | null };
            const processedData: UserStatus = {};
            Object.entries(lobbyData).forEach(([userId, status]) => {
              processedData[userId] = status;
            });
            setOnlineUsers(processedData);
            break;
          }

        case 'join':
          if (message.data === clientIdRef.current) break;
          setOnlineUsers(prev => ({ ...prev, [message.data]: false }));
          break;

        case 'leave':
          if (message.data === clientIdRef.current) break;
          setOnlineUsers(prev => {
            const newStatus = { ...prev };
            delete newStatus[message.data];
            return newStatus;
          });
          break;

        case 'update':
          if (message.data === clientIdRef.current) break;
          setOnlineUsers(prev => {
            if (prev[message.data] !== undefined) {
              return { ...prev, [message.data]: true };
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

        case 'chat':
          {
            const chatMsg: ChatMessage = {
              id: crypto.randomUUID(),
              sender: message.sender,
              message: message.data,
              timestamp: new Date(message.timestamp || Date.now()),
              isSelf: message.sender === clientIdRef.current
            };
            setChatMessages(prev => [...prev, chatMsg]);
            break;
          }

      }
    } catch (error) {
      console.error('Error handling message:', error);
      setError(`Failed to handle ${message.type} message`);
    }
  }, [handleRemoteOffer, resetConnection]);


  const handleChatMessage = (text: string) => {
    if (!text.trim() || !remotePeerId) return;
    const msg: ChatMessage = { id: crypto.randomUUID(), sender: clientIdRef.current, message: text.trim(), timestamp: new Date(), isSelf: true };
    setChatMessages(p => [...p, msg]);
    console.log(`trying to send the message in the room ${currentRoomRef.current}`)
    stompClientRef.current?.publish({
      destination: `/app/chat/${currentRoomRef.current}`,
      body: JSON.stringify({ type: 'chat', data: text.trim(), sender: clientIdRef.current })
    });
    setChatInput('');
  };

  const toggleMicrophone = () => {
    const audio = localStreamRef.current?.getAudioTracks()[0];
    if (audio) { audio.enabled = !audio.enabled; setIsMuted(!audio.enabled); }
  };
  const toggleVideo = () => {
    const video = localStreamRef.current?.getVideoTracks()[0];
    if (video) { video.enabled = !video.enabled; setIsVideoOff(!video.enabled); }
  };

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

      // Clear chat messages when starting a new call
      setChatMessages([]);
      setChatInput('');

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
      webSocketFactory: () => {
        const getSocketUrl = () => {
          if (import.meta.env.VITE_API_URL) {
            return `${import.meta.env.VITE_API_URL}/ws`;
          }
          if (import.meta.env.DEV) {
            return 'http://localhost:8080/ws';
          }
          return '/ws'; // Production fallback (relative path for Nginx proxy)
        };
        return new SockJS(getSocketUrl());
      },
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

        client.subscribe('/user/' + clientIdRef.current + '/queue/private/lobby-info', (message) =>
          handleSignalingMessage(JSON.parse(message.body)));

        client.subscribe('/user/' + clientIdRef.current + '/queue/private/lobby-update', (message) =>
          handleSignalingMessage(JSON.parse(message.body)));

        client.subscribe('/user/' + clientIdRef.current + '/queue/private/room-assignment', (message) =>
          handleSignalingMessage(JSON.parse(message.body)));

        client.subscribe('/user/' + clientIdRef.current + '/queue/private/call-ended', (message) =>
          handleSignalingMessage(JSON.parse(message.body)));

        client.subscribe('/user/' + clientIdRef.current + '/queue/private/signal/', (message) =>
          handleSignalingMessage(JSON.parse(message.body)));

        client.subscribe('/user/' + clientIdRef.current + '/queue/private/chat/', (message) =>
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
    <div className={styles['vc-root']}>
      {/* Header Bar */}
      <div className={styles['vc-header']}>
        <div className={styles['vc-header-left']}>
          <VideoIcon className={styles['vc-header-icon']} />
          <span className={styles['vc-header-title']}>Video Call</span>
          <span className={styles['vc-header-room']}>Room: {currentRoomRef.current || '----'}</span>
        </div>
        <div className={styles['vc-header-right']}>
          <span className={styles['vc-online-dot']}></span>
          <span className={styles['vc-header-online']}>{Object.keys(onlineUsers).length} Online</span>
        </div>
      </div>
      {/* Main Area */}
      <div className={styles['vc-main']}>
        {/* Video Area */}
        <div className={styles['vc-video-area']}>
          <div className={styles['vc-remote-video-wrap']}>
            <video ref={remoteVideoRef} autoPlay playsInline className={styles['vc-remote-video']} />
            <span className={styles['vc-label'] + ' ' + styles['stranger']}>{remotePeerId ? remotePeerId.slice(0, 8) + '...' : 'Stranger'}</span>
            {/* Local video as overlay */}
            <div className={styles['vc-local-video-overlay']}>
              <video ref={localVideoRef} autoPlay muted playsInline className={styles['vc-local-video']} />
              <span className={styles['vc-label'] + ' ' + styles['you']}>Local</span>
            </div>
            {/* Loading overlay when connecting */}
            {isConnecting && (
              <div className={styles['vc-loading-overlay']}>
                <div className={styles['vc-loading-content']}>
                  <div className={styles['vc-loading-spinner']}></div>
                  <span className={styles['vc-loading-text']}>Finding new peer...</span>
                </div>
              </div>
            )}
          </div>
          {/* Controls */}
          <div className={styles['vc-controls']}>
            {!isCallActive && !isConnecting ? (
              <button onClick={startCall} className={`${styles['vc-btn']} ${styles['vc-btn-start']}`} title="Start Call">
                Start Call
              </button>
            ) : (
              <>
                <button onClick={toggleMicrophone} className={`${styles['vc-btn']} ${isMuted ? styles['vc-muted'] : ''}`} title="Toggle Mic">{isMuted ? <MicOff size={24} /> : <Mic size={24} />}</button>
                <button onClick={toggleVideo} className={`${styles['vc-btn']} ${isVideoOff ? styles['vc-muted'] : ''}`} title="Toggle Video">{isVideoOff ? <VideoOff size={24} /> : <Video size={24} />}</button>
                <button onClick={resetConnection} className={styles['vc-btn'] + ' ' + styles['vc-btn-end']} title="End Call"><PhoneOff size={24} /></button>
                <button onClick={handleNextCall} className={styles['vc-btn'] + ' ' + styles['vc-btn-next']} title="Next"><SkipForward size={24} /></button>
              </>
            )}
          </div>
        </div>
        {/* Chat Panel */}
        <div className={styles['vc-chat-section']}>
          <div className={styles['vc-chat-header']}><MessageCircle className={styles['vc-chat-header-icon']} /> Chat</div>
          <div className={styles['vc-chat-body']} ref={chatContainerRef}>
            {chatMessages.map(m => (
              <div key={m.id} className={styles['vc-chat-msg'] + ' ' + (m.isSelf ? styles['self'] : styles['other'])}>
                <div className={styles['vc-chat-bubble'] + ' ' + (m.isSelf ? styles['self'] : styles['other'])}>
                  <span>{m.message}</span>
                  <span className={styles['vc-chat-time']}>{m.timestamp.toLocaleTimeString()}</span>
                </div>
              </div>
            ))}
          </div>
          <form className={styles['vc-chat-input']} onSubmit={e => {
            e.preventDefault();
            if (chatInput.trim() && remotePeerId) {
              handleChatMessage(chatInput);
            }
          }}>
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              placeholder="Type a message..."
              disabled={!remotePeerId}
              className={styles['vc-chat-input-box']}
            />
            <button type="submit" disabled={!remotePeerId || !chatInput.trim()} className={styles['vc-chat-send']}><Send size={18} /></button>
          </form>
        </div>
      </div>
      {/* Status Bar */}
      <div className={styles['vc-status-bar']}>
        <div className={styles['vc-status-item']}><span className={styles['vc-status-label']}>Connection:</span> <span className={styles['vc-status-dot'] + ' ' + styles['connected']}></span> {connectionStatus}</div>
        <div className={styles['vc-status-item']}><span className={styles['vc-status-label']}>Peer Connection:</span> <span className={styles['vc-status-dot'] + ' ' + styles['connected']}></span> {connectionState}</div>
        <div className={styles['vc-status-item']}><span className={styles['vc-status-label']}>ICE Connection:</span> <span className={styles['vc-status-dot'] + ' ' + styles['connected']}></span> {iceConnectionState}</div>
        <div className={styles['vc-status-item']}><span className={styles['vc-status-label']}>Signaling:</span> <span className={styles['vc-status-dot'] + ' ' + styles['connected']}></span> {signalingState}</div>
        <div className={styles['vc-status-item']}><span className={styles['vc-status-label']}>Online Users:</span> {Object.keys(onlineUsers).length}</div>
        <div className={styles['vc-status-item']}><span className={styles['vc-status-label']}>Role:</span> {roleRef.current || 'None'}</div>
        <div className={styles['vc-status-item']}><span className={styles['vc-status-label']}>Client ID:</span> {clientIdRef.current.slice(0, 8) + ' ...'}</div>
      </div>
      {error && <div className={styles['vc-error-toast']}>{error}</div>}
    </div>
  );

};

export default VideoChat;