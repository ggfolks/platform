import {Disposable, PMap, log} from "../core/util"
import {UUID, UUID0} from "../core/uuid"
import {Decoder, Encoder} from "../core/codec"
import {Path} from "../core/path"
import {Emitter, Mutable, Stream, Value} from "../core/react"
import {Auth, AuthValidator, SessionAuth, noAuth} from "../auth/auth"
import {ChanMsg, ChanType, encodeMsg, decodeMsg} from "./protocol"

const DebugLog = false

/** Indicates the connectedness state of a channel:
  * - `connecting`: waiting for a connection to the server or for the other end of the channel to
  * be resolved.
  * - `open`: the channel is connected and messages are flowing.
  * - `closed`: the channel has been closed. No messages may be sent or will be received.
  */
export type CState = "connecting" | "open" | "failed" | "closed"

/** Used to encode and decode messages on a channel. */
export type ChannelCodec<M> = {
  encode: (enc :Encoder, rcpt :Auth, msg :M) => void
  decode: (dec :Decoder) => M
}

/** Maintains a two-way communication channel between two endpoints, usually one end on a client and
  * one end on a server. Channels are used to multiplex different services (data, space, rpc) over a
  * single websocket connection. */
export interface Channel<M> extends Disposable {
  /** The connection state of this channel. See [[CState]]. */
  state :Value<CState>
  /** The auth info for this channel (generally only valid on server side). Can change if connection
    * escalates auth (from guest to authed user, for example). */
  auth :Value<Auth>
  /** The acked auth id for this channel (generally only valid on client side).
    * Starts as `UUID0` and transitions to the acked id after auth succeeds. */
  ackedId :Value<UUID>
  /** The type of this channel. */
  type :string
  /** The path to this channel. */
  path :Path
  /** Emits messages that are received on this channel. */
  messages :Stream<M>
  /** Encodes and sends `msg` over this channel. */
  sendMsg (msg :M) :void
}

export interface Connection {
  state :Value<CState>
  send :(msg :Uint8Array) => boolean
  msgs :Stream<Uint8Array>
}

/** Creates channel sessions when the remote end opens a channel with a type and path. The handler
  * is passed the channel path and a function that can be used to make a channel (given a codec).
  * It should return the created channel (potentially asynchronously) if the channel open is to
  * succeed. It can also return a failed promise to reject the channel creation request. The handler
  * can eventually close the channel it created, and should clean itself up if it sees the channel
  * transition to the `closed` state (indicating that the other end closed the channel). */
export type ChannelHandler<M> = (
  auth :Value<Auth>, path :Path, mkChannel :(codec :ChannelCodec<M>) => Channel<M>
) => Promise<Channel<M>>

const META_ID = 0 // channel id 0 is reserved for channel management messages
const MAX_CHANNELS = 65535

/** Manages a collection of channels over one end of a single connection. The client will have a
  * manager for each connection to a server (if it connects to multiple servers), and a server will
  * have a manager for each client connection. */
export class ChannelManager {
  private readonly channels = new Map<number, ChannelImpl<any>>()
  private readonly handlers :PMap<ChannelHandler<any>> = {}
  private readonly meta = new ChannelImpl<ChanMsg>(
    this, META_ID, "meta", [], {encode: encodeMsg, decode: decodeMsg})
  private readonly _auth = Mutable.local<Auth>(noAuth)
  private readonly _ackedId = Mutable.local(UUID0)
  private lastChannelId = 0

  constructor (readonly conn :Connection,
               handlers :PMap<ChannelHandler<any>> = {},
               readonly authers :PMap<AuthValidator> = {}) {
    Object.assign(this.handlers, handlers)
    this.meta.state.update("open") // meta is always open for business
    this.channels.set(META_ID, this.meta)
    this.conn.msgs.onEmit(msg => this.recvMsg(msg))
    this.meta.messages.onEmit(msg => this.handleMeta(msg))

    // if we lose our connection, close all open channels
    this.conn.state.when(s => s === "closed", _ => {
      this.channels.forEach(c => (c.id !== META_ID) && c.dispose())
      this._auth.update(noAuth)
      this._ackedId.update(UUID0)
    })
  }

  /** The authentication state of the the connection. (Usually only valid on the sever.) */
  get auth () :Value<Auth> { return this._auth }

  /** The acked authentication id for the connection. (Usually only valid on the client.) */
  get ackedId () :Value<UUID> { return this._ackedId }

  /** Registers a handler for channels of `type` which this manager. */
  addHandler (type :string, handler :ChannelHandler<any>) {
    if (this.handlers[type]) throw new Error(`Handler already registered for type '${type}'`)
    this.handlers[type] = handler
  }

  /** Creates a channel with the supplied configuration. The type of messages handled by the channel
    * will be dictacted by the handler registered for `ctype`. The manager must have a handler
    * registration for the requested type.
    * @param ctype the type of channel (i.e. `object`, `view`, `service`, `space`, etc.).
    * @param cpath the path associated with the channel (will be used to resolve a particular
    * endpoint on the remote end).
    * @param codec used to encode and decode messages over the channel. */
  createChannel<M> (ctype :string, cpath :Path, codec :ChannelCodec<M>) :Channel<M> {
    const id = this.assignChannelId()
    if (DebugLog) log.debug("Creating channel", "type", ctype, "path", cpath, "id", id)
    const channel = new ChannelImpl<M>(this, id, ctype, cpath, codec)
    this.channels.set(id, channel)
    // wait until we're authed to send the OPEN request
    this.ackedId.whenOnce(id => id !== UUID0, _ => this.meta.sendMsg(
      {type: ChanType.OPEN, id, ctype, cpath}))
    return channel
  }

  sendAuth (auth :SessionAuth) { this.meta.sendMsg({type: ChanType.AUTH, ...auth}) }

  routeMsg (id :number, msg :Uint8Array) :boolean { return this.conn.send(msg) }

  recvMsg (msg :Uint8Array) {
    const dec = new Decoder(msg)
    const id = dec.getValue("size16")
    const channel = this.channels.get(id)
    if (channel) channel.recvMsg(dec)
    else log.warn("Dropping message for unknown channel", "id", id)
  }

  closeChannel (channel :ChannelImpl<any>) {
    this.channels.delete(channel.id)
    // if we're closing a channel due to connection disconnect, don't try to send a close notice
    if (this.conn.state.current === "open") this.meta.sendMsg(
      {type: ChanType.CLOSE, id: channel.id})
    channel.state.update("closed")
  }

  private handleMeta (msg :ChanMsg) {
    if (msg.type === ChanType.AUTH) {
      const auther = this.authers[msg.source]
      if (auther) auther.validateAuth(msg.id, msg.token).onValue(auth => {
        this._auth.update(auth)
        this.meta.sendMsg({type: ChanType.AUTHED, id: msg.id})
        log.info("Connection authed", "conn", this.conn, "source", msg.source)
      })
      else log.warn("Connection authed with invalid auth source", "conn", this.conn, "msg", msg)

    } else if (msg.type === ChanType.AUTHED) {
      if (DebugLog) log.debug("Auth acked", "id", msg.id)
      this._ackedId.update(msg.id)

    } else if (msg.type === ChanType.OPEN) {
      const handler = this.handlers[msg.ctype]
      if (handler) this.startChannel(handler, msg.ctype, msg.cpath, msg.id)
      else {
        log.warn("Open channel for unknown type", "msg", msg)
        this.meta.sendMsg({type: ChanType.FAILED, id: msg.id, cause: "unknown_type"})
      }

    } else {
      const channel = this.channels.get(msg.id)
      if (channel) {
        switch (msg.type) {
        case ChanType.READY:
          channel.remoteId = msg.remoteId
          channel.state.update("open")
          break
        case ChanType.FAILED:
          this.channels.delete(msg.id)
          channel.state.update("failed")
          log.warn("Failed to open channel", "channel", channel, "cause", msg.cause)
          break
        case ChanType.CLOSE:
          this.channels.delete(msg.id)
          channel.state.update("closed")
          break
        }
      } else {
        log.warn("Missing channel for meta message", "msg", msg)
      }
    }
  }

  private assignChannelId () :number {
    const channels = this.channels
    if (channels.size === MAX_CHANNELS) throw new Error(`Too many channels!`)
    let id = this.lastChannelId
    do {
      id += 1
      if (id >= MAX_CHANNELS) id = 1
    } while (this.channels.has(id))
    this.lastChannelId = id
    return id
  }

  private async startChannel<M> (handler :ChannelHandler<M>, type :string, path :Path, id :number) {
    if (DebugLog) log.debug("Starting channel", "type", type, "path", path, "id", id)
    const localId = this.assignChannelId()
    try {
      const channel = await handler(this.auth, path, codec => {
        const channel = new ChannelImpl<M>(this, localId, type, path, codec)
        channel.remoteId = id
        return channel
      }) as ChannelImpl<M>
      this.channels.set(localId, channel)
      this.meta.sendMsg({type: ChanType.READY, id, remoteId: localId})
      channel.state.update("open")
    } catch (error) {
      this.meta.sendMsg({type: ChanType.FAILED, id, cause: error.message})
      this.channels.delete(localId)
    }
  }
}

class ChannelImpl<M> implements Channel<M> {
  private readonly encoder = new Encoder()
  readonly state = Mutable.local<CState>("connecting")
  readonly messages = new Emitter<M>()
  remoteId = 0 // assigned when ready

  constructor (readonly cmgr :ChannelManager, readonly id :number,
               readonly type :string, readonly path :Path,
               readonly codec :ChannelCodec<M>) {}

  get auth () { return this.cmgr.auth }
  get ackedId () { return this.cmgr.ackedId }

  sendMsg (msg :M) {
    switch (this.state.current) {
    case "closed":
    case "failed":
      throw new Error(`Cannot send on closed channel [channel=${this}]`)
    case "connecting":
      this.state.whenOnce(s => s === "open", _ => this.sendMsg(msg))
      break
    case "open":
      if (DebugLog) log.debug("sendMsg", "channel", this, "msg", msg)
      let data :Uint8Array
      try {
        this.encoder.addValue(this.remoteId, "size16")
        this.codec.encode(this.encoder, this.auth.current, msg)
        data = this.encoder.finish()
      } catch (error) {
        log.warn("Failed to encode message", "channel", this, "msg", msg, error)
        this.encoder.reset()
        return
      }
      if (!this.cmgr.routeMsg(this.id, data)) {
        log.warn("Dropped message due to closed connection", "channel", this, "msg", msg)
      }
      break
    }
  }

  recvMsg (dec :Decoder) {
    try {
      const msg = this.codec.decode(dec)
      if (DebugLog) log.debug("recvMsg", "channel", this, "msg", msg)
      this.messages.emit(msg)
    } catch (error) {
      log.warn("Failed to decode message", "channel", this, "size", dec.source.length, error)
    }
  }

  dispose () {
    this.cmgr.closeChannel(this)
  }

  toString () { return `${this.type}:${this.id}:${this.path.join("/")}` }
}
