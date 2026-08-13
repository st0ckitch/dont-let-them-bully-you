/* global Peer */
// P2P multiplayer transport: PeerJS over the free public PeerServer for
// signaling, then everything is direct WebRTC — a reliable DataChannel for
// lobby/game messages and a media call for voice. No backend of our own:
// the 4-digit lobby code IS the host's peer id (prefixed to dodge collisions
// with other apps on the shared public server).
const ID_PREFIX = 'dltby-mp-';

export class Net {
  constructor(cb) {
    this.cb = cb; // { onOpen(code), onConnect(), onMsg(data), onClose(), onError(err), onRemoteStream(stream), onMicState(state) }
    this.peer = null;
    this.conn = null;
    this.mediaCall = null;
    this.micStream = null;
    this.isHost = false;
    this.code = null;
    this.micState = 'off'; // off | on | muted | blocked
    this._closed = false;
  }

  host() {
    this.isHost = true;
    this.code = String(1000 + Math.floor(Math.random() * 9000));
    this.peer = new Peer(ID_PREFIX + this.code);
    this.peer.on('open', () => this.cb.onOpen(this.code));
    this.peer.on('connection', conn => {
      if (this.conn) { conn.close(); return; } // lobby is full
      this._attach(conn);
    });
    // guest dials the voice call; answer with our mic (or silent if blocked)
    this.peer.on('call', async call => {
      this.mediaCall = call;
      await this._ensureMic();
      call.answer(this.micStream || undefined);
      call.on('stream', s => this.cb.onRemoteStream(s));
    });
    this.peer.on('error', err => {
      // id taken = another lobby picked the same code — just roll a new one
      if (err.type === 'unavailable-id' && !this._closed) {
        this.peer.destroy();
        this.host();
      } else this._error(err);
    });
    this.peer.on('disconnected', () => this.peer?.reconnect());
  }

  join(code) {
    this.isHost = false;
    this.code = code;
    this.peer = new Peer();
    this.peer.on('open', () => {
      this._attach(this.peer.connect(ID_PREFIX + code, { reliable: true }));
      // give the data channel a beat, then start voice
      setTimeout(async () => {
        if (this._closed || !this.peer) return;
        await this._ensureMic();
        if (this.micStream) {
          this.mediaCall = this.peer.call(ID_PREFIX + code, this.micStream);
          this.mediaCall?.on('stream', s => this.cb.onRemoteStream(s));
        }
      }, 600);
    });
    this.peer.on('error', err => {
      if (err.type === 'peer-unavailable') this._error({ type: 'no-lobby' });
      else this._error(err);
    });
    this.peer.on('disconnected', () => this.peer?.reconnect());
  }

  _attach(conn) {
    this.conn = conn;
    conn.on('open', () => this.cb.onConnect());
    conn.on('data', d => this.cb.onMsg(d));
    conn.on('close', () => { if (!this._closed) this.cb.onClose(); });
    conn.on('error', err => this._error(err));
  }

  send(obj) {
    if (this.conn?.open) this.conn.send(obj);
  }

  async _ensureMic() {
    if (this.micStream || this.micState === 'blocked') return;
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.micState = 'on';
    } catch {
      this.micState = 'blocked';
    }
    this.cb.onMicState(this.micState);
  }

  toggleMute() {
    if (!this.micStream) return this.micState;
    const muted = this.micState === 'on';
    for (const t of this.micStream.getAudioTracks()) t.enabled = !muted;
    this.micState = muted ? 'muted' : 'on';
    this.cb.onMicState(this.micState);
    return this.micState;
  }

  _error(err) {
    if (!this._closed) this.cb.onError(err);
  }

  destroy() {
    this._closed = true;
    try { this.micStream?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    try { this.mediaCall?.close(); } catch { /* ignore */ }
    try { this.conn?.close(); } catch { /* ignore */ }
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.micStream = this.mediaCall = this.conn = this.peer = null;
  }
}
