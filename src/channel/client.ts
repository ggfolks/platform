import {Disposer, log} from "../core/util"
import {Path} from "../core/path"
import {Emitter, Mutable, Value} from "../core/react"
import {SessionAuth, sessionAuth} from "../auth/auth"
import {Channel, ChannelCodec, ChannelHandler, ChannelManager, Connection, CState} from "./channel"

const DebugLog = false

export interface ClientConfig {
  serverUrl :URL
  auth? :Value<SessionAuth>
}

interface Socket {
  send (msg :Uint8Array) :void
  close () :void
}

export class ChannelClient implements Connection {
  private readonly disposer = new Disposer()
  private socket :Socket
  private reconnectAttempts = 0

  readonly auth :Value<SessionAuth>
  readonly state = Mutable.local<CState>("connecting")
  readonly manager :ChannelManager
  readonly msgs = new Emitter<Uint8Array>()

  constructor (readonly config :ClientConfig) {
    this.manager = new ChannelManager(this)
    this.auth = config.auth || sessionAuth
    this.auth.onChange(auth => this.manager.sendAuth(auth))
    this.disposer.add(this.state.onValue(state => {
      if (DebugLog) log.debug(`Client connect state: ${state}`)
      switch (state) {
      case "open":
        this.reconnectAttempts = 0
        this.manager.sendAuth(this.auth.current)
        break
      case "closed":
        const reconns = this.reconnectAttempts = this.reconnectAttempts+1
        const delay = Math.pow(2, Math.min(reconns, 9)) // max out at ~10 mins
        log.debug("Scheduling reconnect", "attempt", reconns, "delay", delay)
        const cancel = setTimeout(() => {
          this.socket.close()
          this.socket = this.openSocket(config.serverUrl)
        }, delay*1000)
        this.disposer.add(() => clearInterval(cancel))
        break
      }
    }))
    this.socket = this.openSocket(config.serverUrl)
  }

  /** Registers a handler for channels of `type` which this manager. */
  addHandler (type :string, handler :ChannelHandler<any>) {
    // TODO: eventually we'll want to keep these separately and when we open a connection to a
    // particular server, we'll create a channel manager for that server and we'll pass the handlers
    // into the manager at creation time
    this.manager.addHandler(type, handler)
  }

  /** Creates a channel with the specified type and path.
    * See [[ChannelManager.createChannel]] for more details. */
  createChannel<M> (ctype :string, cpath :Path, codec :ChannelCodec<M>) :Channel<M> {
    return this.manager.createChannel(ctype, cpath, codec)
  }

  send (msg :Uint8Array) :boolean {
    switch (this.state.current) {
    case "connecting":
      this.state.whenOnce(s => s === "open", _ => this.send(msg))
      return true
    case "open":
      this.socket.send(msg)
      return true
    case "failed":
    case "closed":
      return false
    }
  }

  dispose () {
    this.disposer.dispose()
    this.socket.close()
  }

  protected openSocket (addr :URL) :Socket {
    const {state, msgs} = this
    log.info("Connecting", "addr", addr)
    state.update("connecting")
    const ws = new WebSocket(addr.href)
    ws.binaryType = "arraybuffer"
    ws.addEventListener("open", ev => {
      state.update("open")
      if (DebugLog) log.debug("Connected", "addr", addr)
    })
    ws.addEventListener("message", ev => msgs.emit(new Uint8Array(ev.data)))
    ws.addEventListener("error", ev => {
      log.warn("WebSocket error", "url", ws.url, "ev", ev)
      state.update("closed")
    })
    ws.addEventListener("close", ev => {
      state.update("closed")
    })
    return ws
  }
}
