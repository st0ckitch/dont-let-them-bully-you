/* global Peer */
// P2P multiplayer transport: PeerJS over the free public PeerServer for
// signaling, then everything is direct WebRTC — a reliable DataChannel for
// lobby/game messages and a media call for voice. No backend of our own:
// the 4-digit lobby code IS the host's peer id (prefixed to dodge collisions
// with other apps on the shared public server).
const ID_PREFIX = 'dltby-mp-';

// Bump on ANY change that shifts the seeded fight's rng consumption
// (fight.js MOVES/TRIM_WINDOWS/DMG_SCALE/rounds, config stats, anim clip
// surgery). Mismatched cached clients would replay the same seed into
// different winners with zero errors — the hello handshake refuses instead.
export const PROTOCOL_VERSION = 2;

// Extra STUN keeps srflx discovery alive when one provider is slow. The
// peerjs.com TURN entries mirror the library's defaultConfig (setting config
// REPLACES it) — probed 2026-08: they gather no relay candidates, i.e. dead,
// same as openrelay.metered.ca and freestun.net. Kept in case the project
// revives them; until then symmetric NAT on BOTH ends cannot connect and a
// working relay needs a paid/keyed TURN account.
const PEER_OPTS = {
  config: {
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
    ],
    sdpSemantics: 'unified-plan',
    iceCandidatePoolSize: 4,
  },
};

// The free PeerJS cloud drops/refuses sockets under load — and mobile carriers
// share one CGNAT ip across thousands of users, so phones hit its rate limits
// far more often than desktops. Those errors are transient: retry, don't die.
// CRITICAL nuance (found the hard way on an iPhone): PeerJS emits
// error('network') BEFORE 'disconnected' when the signaling socket drops, and
// iOS kills that socket every time Safari backgrounds — e.g. the host
// switching to Messages to share the code. Once a session is REGISTERED or a
// DataChannel is OPEN, never destroy the peer for these: destroy() would tear
// down the healthy P2P link too (and free the lobby id for ghosts). Reconnect
// the same peer instead — same id, same session token.
const RETRYABLE = new Set(['network', 'server-error', 'socket-error', 'socket-closed']);
const MAX_TRIES = 3;
const MAX_RECONNECTS = 6;
const JOIN_TIMEOUT_MS = 20000;

export class Net {
  constructor(cb) {
    this.cb = cb; // { onOpen(code), onConnect(), onMsg(data), onClose(), onError(err), onRetry(n,max), onRemoteStream(stream), onMicState(state) }
    this.peer = null;
    this.conn = null;
    this.mediaCall = null;
    this.micStream = null;
    this.isHost = false;
    this.code = null;
    this.registered = false; // peer 'open' confirmed by the signaling server
    this.micState = 'off'; // off | on | muted | blocked
    this._closed = false;
    this._tries = 0;
    this._reconnects = 0;
    // iOS Safari kills the signaling socket when the tab backgrounds —
    // resurrect it immediately on return (cancels any pending backoff timer)
    this._visHandler = () => {
      if (document.visibilityState === 'visible' && this.peer && !this.peer.destroyed && this.peer.disconnected) {
        clearTimeout(this._reconnT);
        this._reconnT = null;
        try { this.peer.reconnect(); } catch { /* ignore */ }
      }
    };
    document.addEventListener('visibilitychange', this._visHandler);
  }

  host() {
    this.isHost = true;
    if (!this.code) this.code = String(1000 + Math.floor(Math.random() * 9000));
    this.peer = new Peer(ID_PREFIX + this.code, PEER_OPTS);
    this.peer.on('open', () => {
      this._tries = 0;
      this._reconnects = 0;
      this.registered = true;
      this.cb.onOpen(this.code);
    });
    this.peer.on('connection', conn => {
      if (this.conn?.open) { conn.close(); return; } // lobby is full (a DEAD conn is cleared on close, so a guest can rejoin)
      this._attach(conn);
    });
    // guest dials the voice call; answer with our mic (or silent if blocked)
    this.peer.on('call', async call => {
      this.mediaCall = call;
      await this._ensureMic();
      if (this._closed || !this.peer || this.peer.destroyed) return; // torn down while the permission prompt was up
      call.answer(this.micStream || undefined);
      call.on('stream', s => this.cb.onRemoteStream(s));
    });
    this.peer.on('error', err => this._handlePeerError(err, () => this.host()));
    this.peer.on('disconnected', () => this._scheduleReconnect());
  }

  join(code) {
    this.isHost = false;
    this.code = code;
    this.peer = new Peer(PEER_OPTS);
    // a join that never opens (ICE blocked between the two networks) must
    // surface as an error, not sit at CONNECTING forever
    if (!this._watchdog) {
      this._watchdog = setTimeout(() => {
        if (!this.conn?.open && !this._closed) this._error({ type: 'connect-timeout' });
      }, JOIN_TIMEOUT_MS);
    }
    this.peer.on('open', () => {
      this._tries = 0;
      this._reconnects = 0;
      this.registered = true;
      this._attach(this.peer.connect(ID_PREFIX + code, { reliable: true }));
      // give the data channel a beat, then start voice — with a silent
      // fallback stream when the mic is blocked, so voice still flows one-way
      // from the host (PeerJS call() requires SOME stream to dial)
      setTimeout(async () => {
        if (this._closed || !this.peer) return;
        await this._ensureMic();
        if (this._closed || !this.peer || this.peer.destroyed) return; // teardown raced the permission prompt
        const stream = this.micStream || this._silentStream();
        if (stream) {
          this.mediaCall = this.peer.call(ID_PREFIX + code, stream);
          this.mediaCall?.on('stream', s => this.cb.onRemoteStream(s));
        }
      }, 600);
    });
    this.peer.on('error', err => {
      if (err.type === 'peer-unavailable') this._error({ type: 'no-lobby' });
      else this._handlePeerError(err, () => this.join(code));
    });
    this.peer.on('disconnected', () => this._scheduleReconnect());
  }

  // Registered/live sessions reconnect the SAME peer (id + session token
  // survive, existing DataChannel/voice stay up — they don't need signaling).
  // Only the never-opened phase retries with fresh peers; 'unavailable-id'
  // there just rerolls the code (it was never shown as shareable).
  _handlePeerError(err, restart) {
    if (this._closed) return;
    if (err.type === 'unavailable-id') {
      this.code = null;
      try { this.peer.destroy(); } catch { /* ignore */ }
      restart();
      return;
    }
    if (RETRYABLE.has(err.type)) {
      if (this.registered || this.conn?.open) {
        this._scheduleReconnect();
        return;
      }
      if (this._tries < MAX_TRIES) {
        this._tries += 1;
        this.cb.onRetry?.(this._tries, MAX_TRIES);
        try { this.peer.destroy(); } catch { /* ignore */ }
        this._retryT = setTimeout(() => { if (!this._closed) restart(); }, 900 * this._tries);
        return;
      }
    }
    this._error(err);
  }

  _scheduleReconnect() {
    if (this._closed || this._reconnT || !this.peer || this.peer.destroyed) return;
    this._reconnects += 1;
    if (this._reconnects > MAX_RECONNECTS && !this.conn?.open) {
      this._error({ type: 'network' });
      return;
    }
    this.cb.onRetry?.(Math.min(this._reconnects, MAX_RECONNECTS), MAX_RECONNECTS);
    this._reconnT = setTimeout(() => {
      this._reconnT = null;
      if (this._closed || !this.peer || this.peer.destroyed) return;
      if (this.peer.disconnected) {
        try { this.peer.reconnect(); } catch { /* ignore */ }
      }
    }, Math.min(1200 * this._reconnects, 8000));
  }

  _attach(conn) {
    this.conn = conn;
    conn.on('open', () => {
      clearTimeout(this._watchdog);
      this._watchdog = null;
      this._reconnects = 0;
      this.cb.onConnect();
    });
    conn.on('data', d => this.cb.onMsg(d));
    conn.on('close', () => {
      if (this.conn === conn) this.conn = null; // free the slot so a guest can rejoin a host lobby
      if (!this._closed) this.cb.onClose();
    });
    conn.on('error', err => this._error(err));
  }

  send(obj) {
    if (this.conn?.open) this.conn.send(obj);
  }

  async _ensureMic() {
    if (this.micStream || this.micState === 'blocked') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this._closed) {
        // teardown raced the permission prompt — release the mic NOW or the
        // iOS "mic in use" indicator stays lit for the life of the tab
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      this.micStream = stream;
      this.micState = 'on';
    } catch {
      if (this._closed) return;
      this.micState = 'blocked';
    }
    this.cb.onMicState(this.micState);
  }

  // silent placeholder stream (a MediaStreamDestination with no source) so a
  // mic-blocked guest can still dial and RECEIVE the host's voice
  _silentStream() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      return ctx.createMediaStreamDestination().stream;
    } catch {
      return null;
    }
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
    clearTimeout(this._watchdog);
    clearTimeout(this._retryT);
    clearTimeout(this._reconnT);
    document.removeEventListener('visibilitychange', this._visHandler);
    try { this.micStream?.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    try { this.mediaCall?.close(); } catch { /* ignore */ }
    try { this.conn?.close(); } catch { /* ignore */ }
    try { this.peer?.destroy(); } catch { /* ignore */ }
    this.micStream = this.mediaCall = this.conn = this.peer = null;
  }
}
