import {PMap, log} from "../core/util"
import {setRandomSource} from "../core/uuid"
import {Stream, Emitter, Mutable, Value} from "../core/react"
import {MutableSet} from "../core/rcollect"
import {AuthValidator} from "../auth/auth"
import {CState, ChannelHandler, ChannelManager, Connection} from "./channel"

import * as http from "http"
import WebSocket from "ws"

import * as crypto from "crypto"
setRandomSource(array => crypto.randomFillSync(Buffer.from(array.buffer)))

export interface ServerConfig {
  /** The port on which to listen iff we create our own http server. */
  port? :number
  /** An optional http server with which to interoperate. */
  httpServer? :http.Server
  /** Maps auth `source` to a validator for credentials from that source. */
  authers :PMap<AuthValidator>
  /** Maps channel `type` to a handler for those channels. */
  handlers :PMap<ChannelHandler<any>>
}

export type ServerState = "initializing" | "listening" | "terminating" | "terminated"

export class ChannelServer {
  private readonly wss :WebSocket.Server
  private readonly _sessions = MutableSet.local<Session>()
  private readonly _state = Mutable.local("initializing" as ServerState)

  /** Emits errors reported by the underlying web socket server. */
  readonly errors :Stream<Error> = new Emitter()

  constructor (readonly config :ServerConfig) {
    const wscfg = config.httpServer ? {server: config.httpServer} : {port: config.port || 8080}
    const wss = this.wss = new WebSocket.Server(wscfg)
    wss.on("listening", () => this._state.update("listening"))
    wss.on("connection", (ws, req) => {
      ws.binaryType = "arraybuffer"
      // if we have an x-forwarded-for header, use that to get the client's IP
      const xffs = req.headers["x-forwarded-for"], xff = Array.isArray(xffs) ? xffs[0] : xffs
      // parsing "X-Forwarded-For: <client>, <proxy1>, <proxy2>, ..."
      const addr = (xff ? xff.split(/\s*,\s*/)[0] : req.connection.remoteAddress) || "<unknown>"
      const sess = new Session(this, addr, ws)
      this._sessions.add(sess)
      sess.state.when(ss => ss === "closed", () => this._sessions.delete(sess))
    })
    wss.on("error", error => (this.errors as Emitter<Error>).emit(error))
  }

  get state () :Value<ServerState> { return this._state }

  shutdown () {
    this._state.update("terminating")
    for (const sess of this._sessions) sess.close()
    this.wss.close(() => this._state.update("terminated"))
  }
}

class Session implements Connection {
  readonly state = Mutable.local("connecting" as CState)
  readonly msgs = new Emitter<Uint8Array>()
  readonly cmgr :ChannelManager

  constructor (readonly server :ChannelServer, readonly addr :string, readonly ws :WebSocket) {
    this.cmgr = new ChannelManager(this, server.config.handlers, server.config.authers)

    const onOpen = () => this.state.update("open")
    if (ws.readyState === WebSocket.OPEN) onOpen()
    else ws.on("open", onOpen)

    ws.on("message", msg => {
      // TODO: do we need to check readyState === CLOSING and drop late messages?
      // santity check
      if (this.state.current === "closed") log.warn(
        "Dropping message that arrived on closed socket", "sess", this);
      else if (msg instanceof ArrayBuffer) this.msgs.emit(new Uint8Array(msg))
      else log.warn("Got non-binary message", "sess", this, "msg", msg)
    })
    ws.on("close", (code, reason) => {
      log.info("Session closed", "sess", this, "code", code, "reason", reason)
      this.didClose()
    })
    ws.on("error", error => {
      log.info("Session failed", "error", error)
      this.didClose()
    })
    // TODO: ping/pong & session timeout

    log.info("Session started", "sess", this)
  }

  send (msg :Uint8Array) :boolean {
    if (this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(msg, err => {
      if (err) log.warn("Message send failed", "sess", this, err) // TODO: terminate?
    })
    return true
  }

  close () {
    this.ws.terminate()
    this.didClose()
  }

  toString () { return this.addr }

  protected didClose () {
    this.state.update("closed")
  }
}
