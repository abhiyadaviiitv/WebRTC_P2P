/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useCallback, useEffect, useRef, useState } from 'react';

const VideoChat: React.FC = () => {
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const [localStream, setLocalStream] = useState<MediaStream | null>(null);
    const [remoteStream] = useState<MediaStream>(() => new MediaStream());

    const [offerSdp, setOfferSdp] = useState<string>('');
    const [answerSdp, setAnswerSdp] = useState<string>('');
    const [remoteIce, setRemoteIce] = useState<string>('');
    const [gatheredIce, setGatheredIce] = useState<string[]>([]);
    const [status, setStatus] = useState<string>('Disconnected');
    const [signalingState, setSignalingState] = useState<string>('new');
    const [isConnectionActive, setIsConnectionActive] = useState(false);

    const initPeerConnection = useCallback(() => {
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                {
                    urls: 'turn:relay1.expressturn.com:3480',
                    username: '000000002065332507',
                    credential: '2dm9ltTqJIjVrRq/LI/QvTm0nPY=',
                }
            ]
        });

        pc.oniceconnectionstatechange = () => {
            setStatus(pc.iceConnectionState);
            if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
                setIsConnectionActive(false);
            } else if (pc.iceConnectionState === 'connected') {
                setIsConnectionActive(true);
            }
        };

        pc.onsignalingstatechange = () => {
            setSignalingState(pc.signalingState);
            console.log('Signaling state changed:', pc.signalingState);
        };

        pc.ontrack = (event) => {
            if (!event.streams || event.streams.length === 0) return;
            event.streams[0].getTracks().forEach(track => {
                if (!remoteStream.getTracks().some(t => t.id === track.id)) {
                    remoteStream.addTrack(track);
                }
            });
        };

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log("New ICE candidate:", event.candidate);
                setGatheredIce((prev) => [...prev, JSON.stringify(event.candidate)]);
            } else {
                console.log("All ICE candidates have been gathered.");
            }
        };

        peerConnectionRef.current = pc;
        return pc;
    }, [remoteStream]);

    const addTracksSafely = useCallback((stream: MediaStream) => {
        const pc = peerConnectionRef.current;
        if (!pc || pc.signalingState === 'closed') {
            console.warn('Cannot add tracks - connection not ready');
            return false;
        }

        try {
            stream.getTracks().forEach(track => {
                pc.addTrack(track, stream);
            });
            return true;
        } catch (error) {
            console.error('Error adding tracks:', error);
            return false;
        }
    }, []);

    useEffect(() => {
        let isMounted = true;
        let stream: MediaStream | null = null;

        const init = async () => {
            try {
                if (!isMounted) return;

                setStatus('Connecting...');
                const pc = initPeerConnection();

                stream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false,
                });

                if (!isMounted) {
                    stream.getTracks().forEach(t => t.stop());
                    return;
                }

                setLocalStream(stream);

                if (localVideoRef.current) {
                    localVideoRef.current.srcObject = stream;
                }

                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = remoteStream;
                }

                if (!addTracksSafely(stream)) {
                    throw new Error('Failed to add tracks - connection not ready');
                }

                setStatus('Ready');
            } catch (error) {
                console.error('Error initializing video chat:', error);
                setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        };

        init();

        return () => {
            isMounted = false;
            if (peerConnectionRef.current) {
                peerConnectionRef.current.close();
                peerConnectionRef.current = null;
            }
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
        };
    }, [initPeerConnection, addTracksSafely]);

    const waitForIceGatheringComplete = (pc: RTCPeerConnection) => {
        return new Promise<void>((resolve) => {
            if (pc.iceGatheringState === 'complete') {
                resolve();
            } else {
                const checkState = () => {
                    if (pc.iceGatheringState === 'complete') {
                        pc.removeEventListener('icegatheringstatechange', checkState);
                        resolve();
                    }
                };
                pc.addEventListener('icegatheringstatechange', checkState);
            }
        });
    };

    const handleCreateOffer = async () => {
        try {
            const pc = peerConnectionRef.current;
            if (!pc || pc.signalingState !== 'stable') {
                throw new Error('Connection not ready for offer');
            }

            setStatus('Creating offer...');
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await waitForIceGatheringComplete(pc);
            setOfferSdp(JSON.stringify(pc.localDescription));
            setStatus('Offer created - send to peer');
        } catch (error) {
            console.error('Offer error:', error);
            setStatus(`Offer failed: ${(error as Error).message}`);
        }
    };

    const handleSetRemoteOffer = async () => {
        try {
            const pc = peerConnectionRef.current;
            if (!pc || !offerSdp) throw new Error('Invalid state or missing offer');
            const offer = JSON.parse(offerSdp);
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            setStatus('Remote offer set');
        } catch (error) {
            console.error('Set remote offer error:', error);
            setStatus(`Set remote offer failed: ${(error as Error).message}`);
        }
    };

    const handleCreateAnswer = async () => {
        try {
            const pc = peerConnectionRef.current;
            if (!pc || pc.signalingState !== 'have-remote-offer') {
                throw new Error('Invalid state for creating answer');
            }

            setStatus('Creating answer...');
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await waitForIceGatheringComplete(pc);
            setAnswerSdp(JSON.stringify(pc.localDescription));
            setStatus('Answer created - send to peer');
        } catch (error) {
            console.error('Answer error:', error);
            setStatus(`Answer failed: ${(error as Error).message}`);
        }
    };

    const handleAddAnswer = async () => {
        try {
            const pc = peerConnectionRef.current;
            if (!pc || !answerSdp) throw new Error('Invalid state or missing answer');
            const answer = JSON.parse(answerSdp);
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
            setStatus('Answer added');
        } catch (error) {
            console.error('Add answer error:', error);
            setStatus(`Failed to add answer: ${(error as Error).message}`);
        }
    };

    const handleAddRemoteIce = async () => {
        try {
            const pc = peerConnectionRef.current;
            if (!pc || !remoteIce) throw new Error('Missing ICE candidate');
            const candidate = JSON.parse(remoteIce);
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('Remote ICE candidate added');
        } catch (error) {
            console.error('Failed to add ICE candidate:', error);
        }
    };

    return (
        <div className="video-chat-container">
            <div className="status">
                Status: {status} | Signaling: {signalingState} | 
                Connection: {isConnectionActive ? 'Active' : 'Inactive'}
            </div>

            <div className="video-grid">
                <div className="video-container">
                    <h3>Local Stream</h3>
                    <video ref={localVideoRef} autoPlay muted playsInline />
                </div>
                <div className="video-container">
                    <h3>Remote Stream</h3>
                    <video ref={remoteVideoRef} autoPlay playsInline />
                </div>
            </div>

            <div className="control-panel">
                <div className="sdp-box">
                    <h4>Offer SDP</h4>
                    <textarea
                        value={offerSdp}
                        onChange={(e) => setOfferSdp(e.target.value)}
                        placeholder="Paste offer here"
                    />
                    <button onClick={handleCreateOffer}>Create Offer</button>
                    <button onClick={handleSetRemoteOffer}>Set Remote Offer</button>
                </div>

                <div className="sdp-box">
                    <h4>Answer SDP</h4>
                    <textarea
                        value={answerSdp}
                        onChange={(e) => setAnswerSdp(e.target.value)}
                        placeholder="Paste answer here"
                    />
                    <button onClick={handleCreateAnswer}>Create Answer</button>
                    <button onClick={handleAddAnswer}>Add Answer</button>
                </div>

                <div className="ice-box">
                    <h4>Local ICE Candidates (copy & send):</h4>
                    <ul style={{ maxHeight: '150px', overflowY: 'auto' }}>
                        {gatheredIce.map((ice, idx) => (
                            <li key={idx}>
                                <pre>{ice}</pre>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="ice-box">
                    <h4>Add Remote ICE Candidate</h4>
                    <textarea
                        value={remoteIce}
                        onChange={(e) => setRemoteIce(e.target.value)}
                        placeholder="Paste ICE candidate JSON here"
                    />
                    <button onClick={handleAddRemoteIce}>Add Remote ICE</button>
                </div>
            </div>
        </div>
    );
};

export default VideoChat;
