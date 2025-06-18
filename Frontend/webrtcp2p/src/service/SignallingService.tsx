export class SignalingService {
    private peerConnection: RTCPeerConnection;
    
    constructor(peerConnection: RTCPeerConnection) {
        this.peerConnection = peerConnection;
    }

    public async createOffer(): Promise<string> {
        if (this.peerConnection.signalingState !== 'stable') {
            throw new Error(`Cannot create offer in state: ${this.peerConnection.signalingState}`);
        }

        const offer = await this.peerConnection.createOffer();
        await this.peerConnection.setLocalDescription(offer);
        return JSON.stringify(offer);
    }

    public async createAnswer(offerString: string): Promise<string> {
        if (this.peerConnection.signalingState !== 'have-remote-offer') {
            throw new Error(`Cannot create answer in state: ${this.peerConnection.signalingState}`);
        }

        const offer = JSON.parse(offerString);
        await this.peerConnection.setRemoteDescription(offer);
        const answer = await this.peerConnection.createAnswer();
        await this.peerConnection.setLocalDescription(answer);
        return JSON.stringify(answer);
    }

    public async addAnswer(answerString: string): Promise<void> {
        if (this.peerConnection.signalingState !== 'have-local-offer') {
            throw new Error(`Cannot add answer in state: ${this.peerConnection.signalingState}`);
        }

        const answer = JSON.parse(answerString);
        await this.peerConnection.setRemoteDescription(answer);
    }
}