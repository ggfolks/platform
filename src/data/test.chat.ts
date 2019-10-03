import {UUID, UUID0, uuidv1} from "../core/uuid"
import {Disposer, Timestamp, Remover, log} from "../core/util"
import {Emitter, Mutable, Subject, Value} from "../core/react"
import {Encoder, Decoder, setTextCodec} from "../core/codec"
import {SessionAuth, guestValidator} from "../auth/auth"
import {CState, ChannelManager, Connection} from "../channel/channel"
import {ChannelClient} from "../channel/client"
import {getPropMetas, dobject, dmap, dvalue, dcollection, dqueue} from "./meta"
import {Auth, DataSource, DContext, DObject, DState, MetaMsg, findObjectType} from "./data"
import {addObject, getObject} from "./protocol"
import {ClientStore} from "./client"
import {MemoryDataStore, channelHandlers} from "./server"

import {TextEncoder, TextDecoder} from "util"
setTextCodec(() => new TextEncoder() as any, () => new TextDecoder() as any)

const DebugLog = false

//
// User object: maintains info on a user

type RoomState = {type :"none"}
               | {type :"created", id :UUID}
               | {type :"joined", id :UUID}

@dobject
export class UserObject extends DObject {

  @dvalue("string")
  username = this.value("")

  @dvalue("timestamp")
  lastLogin = this.value(0)

  @dvalue("record")
  room = this.value<RoomState>({type: "none"})

  @dqueue(handleUserReq)
  userq = this.queue<UserReq>()

  canSubscribe (auth :Auth) { return auth.id === this.key || super.canSubscribe(auth) }
  canWrite (prop :string, who :Auth) { return (prop === "username") || super.canWrite(prop, who) }
}

const userQ = (id :UUID) => UserObject.queueAddr(["users", id], "userq")

type UserReq = {type :"enter", room :UUID}
             | {type :"created", room :UUID}

function handleUserReq (ctx :DContext, obj :UserObject, req :UserReq) {
  if (DebugLog) log.debug("handleUserReq", "req", req)
  switch (req.type) {
  case "enter":
    if (ctx.auth.isSystem) {
      obj.room.update({type: "joined", id: req.room})
      ctx.post(roomQ(req.room), {type: "joined", id: obj.key, username: obj.username.current})
    }
    break
  case "created":
    if (ctx.auth.isSystem) {
      obj.room.update({type: "created", id: req.room})
    }
    break
  }
}

//
// Room object: handles data for a single chat room

type MID = number

type RoomReq = {type :"created", owner :UUID, name :string}
             | {type :"join"}
             | {type :"joined", id :UUID, username :string}
             | {type :"speak", text :string}
             | {type :"edit", mid :MID, newText :string}
             | {type :"rename", name :string}
             | {type :"delete"}

interface Message {
  sender :UUID
  sent :Timestamp
  text :string
  edited? :Timestamp
}

interface OccupantInfo {
  username :string
}

@dobject
export class RoomObject extends DObject {

  @dvalue("uuid")
  readonly owner = this.value("")

  @dvalue("string")
  name = this.value("")

  @dmap("uuid", "record")
  occupants = this.map<UUID, OccupantInfo>()

  @dvalue("size32")
  nextMsgId = this.value(1)

  @dmap("size32", "record")
  messages = this.map<MID, Message>()

  @dqueue(handleRoomReq)
  roomq = this.queue<RoomReq>()

  @dqueue(handleMetaMsg)
  metaq = this.queue<MetaMsg>()

  canSubscribe (auth :Auth) {
    if (DebugLog) log.debug("canSubscribe", "auth", auth, "occs", Array.from(this.occupants.entries()))
    return this.occupants.has(auth.id) || super.canSubscribe(auth)
  }
}

const roomQ = (id :UUID) => RoomObject.queueAddr(["rooms", id], "roomq")

function handleRoomReq (ctx :DContext, obj :RoomObject, req :RoomReq) {
  if (DebugLog) log.debug("handleRoomReq", "req", req)
  switch (req.type) {
  case "created":
    obj.owner.update(req.owner)
    obj.name.update(req.name)
    break
  case "join":
    // we could do an auth or ban list check here
    if (DebugLog) log.debug("Adding occupant", "room", obj.key, "user", ctx.auth.id)
    obj.occupants.set(ctx.auth.id, {username: "?"})
    ctx.post(userQ(ctx.auth.id), {type: "enter", room: obj.key})
    ctx.post(sysChatQ, {type: "occupied", id: obj.key, occupants: obj.occupants.size})
    break

  case "joined":
    if (ctx.auth.isSystem) {
      const info = obj.occupants.get(req.id)
      if (info) obj.occupants.set(req.id, {...info, username: req.username})
    }
    break

  case "speak":
    if (obj.occupants.has(ctx.auth.id) || ctx.auth.isSystem) {
      const mid = obj.nextMsgId.current
      obj.nextMsgId.update(mid+1)
      obj.messages.set(mid, {sender: ctx.auth.id, sent: Timestamp.now(), text: req.text})
    }
    break

  case "edit":
    const msg = obj.messages.get(req.mid)
    if (msg && msg.sender === ctx.auth.id) {
      obj.messages.set(req.mid, {...msg, text: req.newText, edited: Timestamp.now()})
    }
    break

  case "rename":
    if (ctx.auth.isSystem || ctx.auth.id === obj.owner.current) {
      obj.name.update(req.name)
      ctx.post(sysChatQ, {type: "renamed", id: obj.key, name: req.name})
    }
    break

  case "delete":
    // TODO
    break
  }
}

function handleMetaMsg (ctx :DContext, obj :RoomObject, msg :MetaMsg) {
  if (DebugLog) log.debug("handleMetaMsg", "msg", msg)
  switch (msg.type) {
  case "unsubscribed":
    if (DebugLog) log.debug("Removing occupant", "room", obj.key, "user", msg.id)
    obj.occupants.delete(msg.id)
    ctx.post(sysChatQ, {type: "occupied", id: obj.key, occupants: obj.occupants.size})
    break
  }
}

//
// Root object: manages chat rooms

type ChatReq = {type :"create" , name :string}

type SysChatReq = {type :"created", id :UUID, name :string}
                | {type :"renamed", id :UUID, name :string}
                | {type :"occupied", id :UUID, occupants :number}
                | {type :"deleted", id :UUID}

interface RoomInfo {
  name :string
  occupants :number
}

@dobject
export class RootObject extends DObject {

  canSubscribe (auth :Auth) { return true }

  @dmap("uuid", "record")
  publicRooms = this.map<UUID, RoomInfo>()

  @dcollection(UserObject)
  users = this.collection<UserObject>()

  @dcollection(RoomObject)
  rooms = this.collection<RoomObject>()

  // @dindex("users", [], [orderBy("lastLogin", "desc")])
  // latestUsers = this.index<UserObject>()

  @dqueue(handleChatReq)
  chatq = this.queue<ChatReq>()

  @dqueue(handleSysChatReq)
  syschatq = this.queue<SysChatReq>()

  updateRoom (id :UUID, op :(info :RoomInfo) => RoomInfo) {
    const oinfo = this.publicRooms.get(id)
    if (oinfo) this.publicRooms.set(id, op(oinfo))
    else log.warn("No room for update", "id", id)
  }
}

const chatQ = RootObject.queueAddr([], "chatq")
const sysChatQ = RootObject.queueAddr([], "syschatq")

function handleChatReq (ctx :DContext, obj :RootObject, req :ChatReq) {
  if (DebugLog) log.debug("handleChatReq", "req", req)
  switch (req.type) {
  case "create":
    const id = uuidv1()
    obj.publicRooms.set(id, {name: req.name, occupants: 0})
    ctx.post(roomQ(id), {type: "created", owner: ctx.auth.id, name: req.name})
    ctx.post(userQ(ctx.auth.id), {type: "created", room: id})
    break
  }
}

function handleSysChatReq (ctx :DContext, obj :RootObject, req :SysChatReq) {
  if (DebugLog) log.debug("handleSysChatReq", "req", req)
  if (ctx.auth.isSystem) {
    switch (req.type) {
    case "renamed":
      obj.updateRoom(req.id, oinfo => ({...oinfo, name: req.name}))
      break
    case "occupied":
      obj.updateRoom(req.id, oinfo => ({...oinfo, occupants: req.occupants}))
      break
    case "deleted":
      obj.publicRooms.delete(req.id)
      break
    }
  }
}

test("metas", () => {
  const rmetas = getPropMetas(RootObject.prototype)
  expect(rmetas[0]).toEqual({
    type: "map", name: "publicRooms", index: 0, ktype: "uuid", vtype: "record", persist: false})
  expect(rmetas[1]).toEqual({type: "collection", name: "users", index: 1, otype: UserObject})
  expect(rmetas[3]).toEqual({type: "queue", name: "chatq", index: 3, handler: handleChatReq})

  const umetas = getPropMetas(UserObject.prototype)
  expect(umetas[0]).toEqual({
    type: "value", name: "username", index: 0, vtype: "string", persist: false})
  expect(umetas[1]).toEqual({
    type: "value", name: "lastLogin", index: 1, vtype: "timestamp", persist: false})

  const rmmetas = getPropMetas(RoomObject.prototype)
  expect(rmmetas[0]).toEqual({
    type: "value", name: "owner", index: 0, vtype: "uuid", persist: false})
  expect(rmmetas[1]).toEqual({
    type: "value", name: "name", index: 1, vtype: "string", persist: false})
})

const sysauth = {id: UUID0, isGuest: false, isSystem: true}

test("access", () => {
  const store = new MemoryDataStore(RootObject)
  const auth1 = {id: uuidv1(), isGuest: false, isSystem: false}
  const auth2 = {id: uuidv1(), isGuest: false, isSystem: false}

  const res = store.resolve(["users", auth1.id]), user = res.object
  expect(user.key).toEqual(auth1.id)

  expect(user.canSubscribe(auth1)).toEqual(true)
  expect(user.canSubscribe(auth2)).toEqual(false)

  expect(user.canWrite("username", auth1)).toEqual(true)
  expect(user.canWrite("username", sysauth)).toEqual(true)

  expect(user.canWrite("lastLogin", auth1)).toEqual(false)
  expect(user.canWrite("lastLogin", sysauth)).toEqual(true)
})

const noopSource :DataSource = {
  post: (index, msg) => {},
  sendSync: (msg) => {},
  createRecord: (path, key, data) => {},
  updateRecord: (path, key, data, merge) => {},
  deleteRecord: (path, key) => {},
}

test("codec", () => {
  const store = new MemoryDataStore(RootObject), roomId = uuidv1()
  const res = store.resolve(["rooms", roomId]), room = res.object as RoomObject

  const id1 = uuidv1(), id2 = uuidv1()
  room.owner.update(id1)
  room.name.update("Test room")
  room.occupants.set(id1, {username: "Testy Testerson"})
  room.occupants.set(id2, {username: "Sandy Clause"})
  room.nextMsgId.update(4)
  const now = Timestamp.now()
  room.messages.set(1, {sender: id1, sent: now.minus(5, Timestamp.MINUTES), text: "Yo Sandy!"})
  room.messages.set(2, {sender: id2, sent: now.minus(3, Timestamp.MINUTES), text: "Hiya Testy."})
  room.messages.set(3, {sender: id1, sent: now.minus(1, Timestamp.MINUTES), text: "How's the elves?"})

  const enc = new Encoder()
  addObject(enc, sysauth, room)

  const msg = enc.finish()
  const dec = new Decoder(msg)
  const state = Value.constant<DState>("active")
  const droom = getObject(dec, new RoomObject(noopSource, ["rooms", roomId], state)) as RoomObject

  expect(droom.owner.current).toEqual(room.owner.current)
  expect(droom.name.current).toEqual(room.name.current)
  expect(Array.from(droom.occupants)).toEqual(Array.from(room.occupants))
  expect(droom.nextMsgId.current).toEqual(room.nextMsgId.current)
  expect(Array.from(droom.messages)).toEqual(Array.from(room.messages))
})

class CObject extends DObject {
  @dvalue("string")
  name = this.value("C")
}
class BObject extends DObject {
  @dcollection(CObject)
  cs = this.collection<CObject>()
}
class AObject extends DObject {
  @dcollection(BObject)
  bs = this.collection<BObject>()
  @dcollection(CObject)
  cs = this.collection<CObject>()
}

test("findObjectType", () => {
  expect(findObjectType(RootObject, [])).toStrictEqual(RootObject)
  expect(findObjectType(RootObject, ["rooms", ""])).toStrictEqual(RoomObject)
  expect(findObjectType(RootObject, ["users", ""])).toStrictEqual(UserObject)
  expect(findObjectType(AObject, ["cs", ""])).toStrictEqual(CObject)
  expect(findObjectType(AObject, ["bs", "", "cs", ""])).toStrictEqual(CObject)
})

type RunQueue = Array<() => void>

function process (queue :RunQueue, onDone :() => void) {
  if (queue.length > 0) {
    queue.shift()!()
    setTimeout(() => process(queue, onDone), 1)
  }
  else onDone()
}

const testAddr = new URL("ws://test/")

class TestSession implements Connection {
  readonly cmgr :ChannelManager
  readonly state = Value.constant<CState>("open")
  readonly msgs = new Emitter<Uint8Array>()

  constructor (readonly store :MemoryDataStore,
               readonly runq :RunQueue,
               readonly client :TestClient) {
    this.cmgr = new ChannelManager(this, channelHandlers(store), {guest: guestValidator})
  }

  send (msg :Uint8Array) :boolean {
    const cmsg = msg.slice()
    this.runq.push(() => this.client.msgs.emit(cmsg))
    return true
  }

  toString () { return "TestSession" }
}

class TestClient extends ChannelClient {
  readonly session :TestSession

  constructor (store :MemoryDataStore, auth :SessionAuth, readonly runq :RunQueue) {
    super({serverUrl: testAddr, auth: Value.constant(auth)})
    this.session = new TestSession(store, runq, this)
    this.state.update("open")
  }

  protected openSocket (url :URL) {
    return {
      send: (msg :Uint8Array) => {
        const cmsg = msg.slice()
        this.runq.push(() => this.session.msgs.emit(cmsg))
      },
      close: () => {},
      toString: () => "TestSocket"
    }
  }
}

test("subscribe-auth", done => {
  const testStore = new MemoryDataStore(RootObject)

  const ida = uuidv1(), idb = uuidv1()
  const queue :RunQueue = []

  const authA = {source: "guest", id: ida, token: ""}
  const clientA = new TestClient(testStore, authA, queue)
  const storeA = new ClientStore(clientA)
  const objAA = storeA.resolve(["users", ida], UserObject)[0]
  expect(objAA.key).toBe(ida)
  let gotAA = false
  objAA.state.whenOnce(s => s === "active", _ => gotAA = true)

  // try to subscribe to user b's object via a, should fail
  const objAB = storeA.resolve(["users", idb], UserObject)[0]
  let failedAB = false
  objAB.state.whenOnce(s => s === "failed", _ => failedAB = true)

  process(queue, () => {
    expect(gotAA).toEqual(true)
    expect(failedAB).toEqual(true)
    done()
  })
})

test("subscribe-post", done => {
  const testStore = new MemoryDataStore(RootObject)

  const ida = uuidv1(), idb = uuidv1()
  const queue :RunQueue = []

  class Chatter {
    readonly subs = new Disposer()
    readonly client :TestClient
    readonly store :ClientStore
    readonly state = Mutable.local("preauth")
    readonly user :UserObject
    room :[RoomObject, Remover]|undefined = undefined

    constructor (id :UUID) {
      this.client = new TestClient(testStore, {source: "guest", id, token: ""}, queue)
      this.store = new ClientStore(this.client)
      if (DebugLog) this.state.onChange(ns => log.debug("Client state", "id", id, "state", ns))

      const [user, unuser] = this.store.resolve(["users", id], UserObject)
      this.subs.add(unuser)
      this.user = user
      user.state.when(s => s === "active", _ => this.state.update("authed"))
      user.room.onValue(rs => {
        switch (rs.type) {
        case    "none": this.joined(undefined) ; break
        case  "joined": this.joined(rs.id) ; break
        case "created": this.join(rs.id) ; break
        }
      })
    }

    join (id :UUID) {
      this.store.post(roomQ(id), {type: "join"})
    }

    joined (id :UUID|undefined) {
      if (DebugLog) log.debug("Client joined room", "cid", this.client.auth.id, "rid", id)
      if (this.room) this.room[1]()
      if (id) {
        this.room = this.store.resolve(["rooms", id], RoomObject)
        const room = this.room[0]
        room.state.when(s => s === "active", _ => {
          this.state.update("entered")
        })
        room.messages.onChange(change => {
          this.state.update(`heard${room.messages.size}`)
        })
      }
    }

    speak (msg :string) {
      this.room && this.room[0].roomq.post({type: "speak", text: msg})
    }

    dispose () {
      this.joined(undefined)
      this.subs.dispose()
    }
  }

  const root = testStore.resolve([]).object as RootObject
  const chatA = new Chatter(ida)
  const chatB = new Chatter(idb)

  Subject.join2(chatA.state, chatB.state).onValue(([a,b]) => {
    // console.log(`States ${a} / ${b}`)
    if (a === "authed" && b === "authed") {
      chatA.store.post(chatQ, {type: "create", name: "Test Room"})
    } else if (a === "entered" && b === "entered") {
      chatA.speak("Hello world.")
    } else if (a === "entered") {
      const rkey = root.publicRooms.keys().next().value
      const ukey = chatA.user.room.current
      expect(ukey).toEqual({type: "joined", id: rkey})
      chatB.join(rkey)
    } else if (a === "heard2" && b === "heard2") {
      chatA.dispose()
      chatB.dispose()
    } else if (a === "heard1" && b === "heard1") {
      chatB.speak("Hello.")
    }
  })

  process(queue, done)
})
