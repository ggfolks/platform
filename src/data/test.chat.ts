import {UUID, UUID0, uuidv1} from "../core/uuid"
import {Disposer, Timestamp, log} from "../core/util"
import {Mutable, Subject, Value} from "../core/react"
import {Decoder, setTextCodec} from "../core/codec"
import {guestValidator} from "../auth/auth"
import {getPropMetas, dobject, dmap, dvalue, dcollection, dindex, dqueue, orderBy} from "./meta"
import {Auth, DObject, DState, MetaMsg, Path, findObjectType} from "./data"
import {MsgEncoder, MsgDecoder} from "./protocol"
import {Address, Client, Connection, CState, Resolved} from "./client"
import {MemoryDataStore, Session, SessionConfig} from "./server"

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

function handleUserReq (obj :UserObject, req :UserReq, auth :Auth) {
  if (DebugLog) log.debug("handleUserReq", "req", req)
  switch (req.type) {
  case "enter":
    if (auth.isSystem) {
      obj.room.update({type: "joined", id: req.room})
      obj.source.post(roomQ(req.room), {type: "joined", id: obj.key, username: obj.username.current})
    }
    break
  case "created":
    if (auth.isSystem) {
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

function handleRoomReq (obj :RoomObject, req :RoomReq, auth :Auth) {
  if (DebugLog) log.debug("handleRoomReq", "req", req)
  switch (req.type) {
  case "created":
    obj.owner.update(req.owner)
    obj.name.update(req.name)
    break
  case "join":
    // we could do an auth or ban list check here
    if (DebugLog) log.debug("Adding occupant", "room", obj.key, "user", auth.id)
    obj.occupants.set(auth.id, {username: "?"})
    obj.source.post(userQ(auth.id), {type: "enter", room: obj.key})
    obj.source.post(sysChatQ, {type: "occupied", id: obj.key, occupants: obj.occupants.size})
    break

  case "joined":
    if (auth.isSystem) {
      const info = obj.occupants.get(req.id)
      if (info) obj.occupants.set(req.id, {...info, username: req.username})
    }
    break

  case "speak":
    if (obj.occupants.has(auth.id) || auth.isSystem) {
      const mid = obj.nextMsgId.current
      obj.nextMsgId.update(mid+1)
      obj.messages.set(mid, {sender: auth.id, sent: Timestamp.now(), text: req.text})
    }
    break

  case "edit":
    const msg = obj.messages.get(req.mid)
    if (msg && msg.sender === auth.id) {
      obj.messages.set(req.mid, {...msg, text: req.newText, edited: Timestamp.now()})
    }
    break

  case "rename":
    if (auth.isSystem || auth.id === obj.owner.current) {
      obj.name.update(req.name)
      obj.source.post(sysChatQ, {type: "renamed", id: obj.key, name: req.name})
    }
    break

  case "delete":
    // TODO
    break
  }
}

function handleMetaMsg (obj :RoomObject, msg :MetaMsg, auth :Auth) {
  if (DebugLog) log.debug("handleMetaMsg", "msg", msg)
  switch (msg.type) {
  case "unsubscribed":
    if (DebugLog) log.debug("Removing occupant", "room", obj.key, "user", msg.id)
    obj.occupants.delete(msg.id)
    obj.source.post(sysChatQ, {type: "occupied", id: obj.key, occupants: obj.occupants.size})
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

  @dindex("users", [], [orderBy("lastLogin", "desc")])
  latestUsers = this.index<UserObject>()

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

function handleChatReq (obj :RootObject, req :ChatReq, auth :Auth) {
  if (DebugLog) log.debug("handleChatReq", "req", req)
  switch (req.type) {
  case "create":
    const id = uuidv1()
    obj.publicRooms.set(id, {name: req.name, occupants: 0})
    obj.source.post(roomQ(id), {type: "created", owner: auth.id, name: req.name})
    obj.source.post(userQ(auth.id), {type: "created", room: id})
    break
  }
}

function handleSysChatReq (obj :RootObject, req :SysChatReq, auth :Auth) {
  if (DebugLog) log.debug("handleSysChatReq", "req", req)
  if (auth.isSystem) {
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
  expect(rmetas[4]).toEqual({type: "queue", name: "chatq", index: 4, handler: handleChatReq})

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
  room.messages.set(1, {sender: id1, sent: now-5*60*1000, text: "Yo Sandy!"})
  room.messages.set(2, {sender: id2, sent: now-3*60*1000, text: "Hiya Testy."})
  room.messages.set(3, {sender: id1, sent: now-1*60*1000, text: "How's the elves?"})

  const enc = new MsgEncoder()
  enc.addObject(sysauth, room)

  const msg = enc.encoder.finish()
  const dec = new Decoder(msg)
  const mdec = new MsgDecoder()
  const state = Value.constant<DState>("active")
  const droom = mdec.getObject(dec, [], {
    getMetas: id => getPropMetas(RoomObject.prototype),
    getObject: id => new RoomObject(
      {post: (queue, msg) => {}, sendSync: (obj, msg) => {}}, ["rooms", roomId], state)
  }) as RoomObject

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

function process (queue :RunQueue) {
  while (queue.length > 0) queue.shift()!()
}

class ClientHandler extends Session {
  constructor (config :SessionConfig, readonly conn :TestConnection,
               readonly queue :RunQueue) { super(config) }

  sendMsg (data :Uint8Array) {
    const cdata = data.slice()
    this.queue.push(() => this.conn.client.recvMsg(cdata))
  }
}

class TestConnection extends Connection {
  private readonly handler :ClientHandler
  readonly state = Value.constant("connected" as CState)

  constructor (readonly client :Client, addr :Address, config :SessionConfig,
               readonly runq :RunQueue) {
    super()
    this.handler = new ClientHandler(config, this, runq)
  }

  sendMsg (data :Uint8Array) {
    const cdata = data.slice()
    this.runq.push(() => this.handler.recvMsg(cdata))
  }

  close () { this.handler.dispose() }
}

test("subscribe-auth", () => {
  const testAddr = {host: "test", port: 0, path: "/"}
  const testLocator = (path :Path) => Subject.constant(testAddr)
  const testStore = new MemoryDataStore(RootObject)
  const sconfig = {store: testStore, authers: {guest: guestValidator}}

  const ida = uuidv1(), idb = uuidv1()
  const queue :RunQueue = []

  const authA = {source: "guest", id: ida, token: ""}
  const clientA = new Client(
    testLocator, Value.constant(authA), (c, a) => new TestConnection(c, a, sconfig, queue))
  const objAA = clientA.resolve(["users", ida], UserObject)[0]
  expect(objAA.key).toBe(ida)
  let gotAA = false
  objAA.state.whenOnce(s => s === "active", _ => gotAA = true)

  // try to subscribe to user b's object via a, should fail
  const objAB = clientA.resolve(["users", idb], UserObject)[0]
  let failedAB = false
  objAB.state.whenOnce(s => s === "failed", _ => failedAB = true)

  process(queue)

  expect(gotAA).toEqual(true)
  expect(failedAB).toEqual(true)
})

test("subscribe-post", done => {
  const testAddr = {host: "test", port: 0, path: "/"}
  const testLocator = (path :Path) => Subject.constant(testAddr)
  const testStore = new MemoryDataStore(RootObject)
  const sconfig = {store: testStore, authers: {guest: guestValidator}}

  const ida = uuidv1(), idb = uuidv1()
  const queue :RunQueue = []

  class Chatter {
    readonly subs = new Disposer()
    readonly client :Client
    readonly state = Mutable.local("preauth")
    readonly user :UserObject
    room :Resolved<RoomObject>|undefined = undefined

    constructor (id :UUID) {
      this.client = new Client(
        testLocator, Value.constant({source: "guest", id, token: ""}),
        (c, a) => new TestConnection(c, a, sconfig, queue))

      if (DebugLog) this.state.onChange(ns => log.debug("Client state", "id", id, "state", ns))

      const [user, unuser] = this.client.resolve(["users", id], UserObject)
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
      this.client.post(roomQ(id), {type: "join"})
    }

    joined (id :UUID|undefined) {
      if (DebugLog) log.debug("Client joined room", "cid", this.client.auth.id, "rid", id)
      if (this.room) this.room[1]()
      if (id) {
        this.room = this.client.resolve(["rooms", id], RoomObject)
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
      chatA.client.post(chatQ, {type: "create", name: "Test Room"})
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
      process(queue)
      done()
    } else if (a === "heard1" && b === "heard1") {
      chatB.speak("Hello.")
    }
  })

  process(queue)
})
