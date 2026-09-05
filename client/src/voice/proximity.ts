import { PROXIMITY_RANGE, PROXIMITY_VOICE_REF, type Vec3 } from "@holojay/shared";

const ICE: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

type Signal =
  | { type: "sdp"; sdp: RTCSessionDescriptionInit | null }
  | { type: "ice"; candidate: RTCIceCandidateInit };

export class ProximityVoice {
  sendSignal: (toId: string, data: unknown) => void = () => {};
  onSpeaking: (active: boolean) => void = () => {};

  private selfId = "";
  private localStream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private peers = new Map<string, RTCPeerConnection>();
  private panners = new Map<string, PannerNode>();
  private gains = new Map<string, GainNode>();
  ptt = false;

  setSelf(id: string): void {
    this.selfId = id;
  }

  async ensureMic(): Promise<void> {
    if (!this.localStream) {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      for (const track of this.localStream.getAudioTracks()) track.enabled = this.ptt;
      for (const [id, pc] of this.peers) {
        for (const track of this.localStream.getAudioTracks()) {
          pc.addTrack(track, this.localStream);
        }
        if (this.selfId < id) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.sendSignal(id, { type: "sdp", sdp: pc.localDescription });
        }
      }
    }
    this.ctx ??= new AudioContext();
    await this.ctx.resume();
  }

  setPtt(on: boolean): void {
    this.ptt = on;
    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) track.enabled = on;
    }
    this.onSpeaking(on);
  }

  async ensurePeer(id: string): Promise<void> {
    if (!id || id === this.selfId || this.peers.has(id)) return;
    const pc = new RTCPeerConnection(ICE);
    this.peers.set(id, pc);

    if (this.localStream) {
      for (const track of this.localStream.getAudioTracks()) {
        pc.addTrack(track, this.localStream);
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) this.sendSignal(id, { type: "ice", candidate: event.candidate });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      this.attachRemote(id, stream);
    };

    if (this.selfId && this.selfId < id) {
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      this.sendSignal(id, { type: "sdp", sdp: pc.localDescription });
    }
  }

  async handleSignal(fromId: string, raw: unknown): Promise<void> {
    const data = raw as Signal;
    await this.ensurePeer(fromId);
    const pc = this.peers.get(fromId);
    if (!pc) return;
    try {
      if (data?.type === "sdp" && data.sdp) {
        const desc = data.sdp;
        if (desc.type === "offer" && pc.signalingState !== "stable") return;
        await pc.setRemoteDescription(desc);
        if (desc.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.sendSignal(fromId, { type: "sdp", sdp: pc.localDescription });
        }
      } else if (data?.type === "ice" && data.candidate) {
        await pc.addIceCandidate(data.candidate);
      }
    } catch {
      // glare / late ice is fine for a small mesh
    }
  }

  private attachRemote(id: string, stream: MediaStream): void {
    if (this.panners.has(id)) return;
    this.ctx ??= new AudioContext();
    const source = this.ctx.createMediaStreamSource(stream);
    const panner = this.ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = PROXIMITY_VOICE_REF;
    panner.maxDistance = PROXIMITY_RANGE;
    panner.rolloffFactor = 1.15;
    const gain = this.ctx.createGain();
    source.connect(panner);
    panner.connect(gain);
    gain.connect(this.ctx.destination);
    this.panners.set(id, panner);
    this.gains.set(id, gain);
  }

  updateListener(pos: Vec3, yaw: number): void {
    if (!this.ctx) return;
    const listener = this.ctx.listener;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    if (listener.positionX) {
      listener.positionX.value = pos.x;
      listener.positionY.value = pos.y;
      listener.positionZ.value = pos.z;
      listener.forwardX.value = fx;
      listener.forwardY.value = 0;
      listener.forwardZ.value = fz;
      listener.upX.value = 0;
      listener.upY.value = 1;
      listener.upZ.value = 0;
    }
  }

  updatePeer(id: string, pos: Vec3, samePlace: boolean): void {
    const panner = this.panners.get(id);
    const gain = this.gains.get(id);
    if (!panner || !gain) return;
    panner.positionX.value = pos.x;
    panner.positionY.value = pos.y;
    panner.positionZ.value = pos.z;
    gain.gain.value = samePlace ? 1 : 0;
  }

  removePeer(id: string): void {
    this.peers.get(id)?.close();
    this.peers.delete(id);
    this.panners.delete(id);
    this.gains.delete(id);
  }

  reset(): void {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.ptt = false;
  }
}

export const voice = new ProximityVoice();
