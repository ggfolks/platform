import {TextEncoder, TextDecoder} from "util"
import {Timestamp} from "../core/util"
import {Encoder, Decoder, ValueType} from "../core/codec"
import {getPropMetas, dobject, dset, dmap, dvalue, dcollection, dqueue} from "./meta"
import {Auth, ID, DataSource, DObject, DObjectType, MetaMsg, Path, SyncReq} from "./data"
import {addObject, getObject} from "./client"

//
// User object: maintains info on a user

@dobject
export class UserObject extends DObject {

  @dvalue("string")
  username = this.value("")

  @dvalue("timestamp")
  lastLogin = this.value(0)

  @dqueue("record", handleUserReq)
  userq = this.queue<UserReq>()

  canSubscribe (auth :Auth) :boolean {
    return auth.id === this.key || super.canSubscribe(auth)
  }
  canWrite (prop :string, who :Auth) {
    return (prop === "username") || super.canWrite(prop, who)
  }
}

type UserReq = {type: "sendUsername", path :Path}

function handleUserReq (obj :UserObject, req :UserReq, auth :Auth) {
  switch (req.type) {
  case "sendUsername":
    const rsp = {type: "setUsername", id: obj.key, username: obj.username.current}
    obj.source.post(req.path, rsp, "record")
    break
  }
}

//
// Room object: handles data for a single chat room

type MID = number

type RoomReq = {type: "speak", text :string} |
               {type: "edit", mid :MID, newText :string} |
               {type: "addOccupant", id :ID} |
               {type: "setUsername", id :ID, username :string}

interface Message {
  sender :ID
  sent :Timestamp
  text :string
  edited? :Timestamp
}

interface OccupantInfo {
  username :string
}

@dobject
export class RoomObject extends DObject {

  @dvalue("string")
  name = this.value("")

  @dmap("id", "record")
  occupants = this.map<ID, OccupantInfo>()

  @dvalue("int32")
  nextMsgId = this.value(1)

  @dmap("int32", "record")
  messages = this.map<MID, Message>()

  @dqueue("record", handleRoomReq)
  roomq = this.queue<RoomReq>()

  @dqueue("record", handleMetaMsg)
  metaq = this.queue<MetaMsg>()

  canSubscribe (auth :Auth) :boolean {
    return this.occupants.has(auth.id) || super.canSubscribe(auth)
  }
}

function handleRoomReq (obj :RoomObject, req :RoomReq, auth :Auth) {
  switch (req.type) {
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

  case "addOccupant":
    if (auth.isSystem) {
      obj.occupants.set(req.id, {username: "?"})
    }
    break

  case "setUsername":
    if (auth.isSystem) {
      const info = obj.occupants.get(req.id)
      if (info) obj.occupants.set(req.id, {...info, username: req.username})
    }
    break
  }
}

function handleMetaMsg (obj :RoomObject, msg :MetaMsg, auth :Auth) {
  switch (msg.type) {
  case "subscribed":
    obj.occupants.set(msg.userId, {username: "?"})
    const req = {type: "sendUsername", path: obj.path.concat(["roomq"])}
    obj.source.post(["users", msg.userId], req, "record")
    break
  case "unsubscribed":
    obj.occupants.delete(msg.userId)
    break
  }
}

//
// Root object: manages chat rooms

type ChatReq = {type :"create" , name :string}
             | {type :"join", id :ID}
             | {type :"delete", id :ID}

interface RoomInfo {
  id :ID
  name :string
  occupants :number
}

@dobject
export class RootObject extends DObject {

  canSubscribe (auth :Auth) :boolean { return true }

  @dset("record")
  publicRooms = this.set<RoomInfo>()

  @dcollection("string", UserObject)
  users = this.collection<ID, UserObject>()

  @dcollection("string", RoomObject)
  rooms = this.collection<ID, RoomObject>()

  @dqueue("record", handleChatReq)
  chatq = this.queue<ChatReq>()
}

function handleChatReq (obj :RootObject, req :ChatReq, auth :Auth) {
  switch (req.type) {
  case "create":
    // TODO
    break
  case "join":
    // TODO
    break
  case "delete":
    // TODO
    break
  }
}

class TestDataSource implements DataSource {

  subscribe<T extends DObject> (path :Path, otype :DObjectType<T>) :Promise<T> {
    return Promise.reject(new Error("test"))
  }
  post<M> (path :Path, msg :M, mtype :ValueType) {} // noop!
  sendSync (path :Path, req :SyncReq) {} // noop!
}

test("metas", () => {
  const rmetas = getPropMetas(RootObject.prototype)
  expect(rmetas.get("publicRooms")).toEqual({type: "set", etype: "record"})
  expect(rmetas.get("users")).toEqual({type: "collection", ktype: "string", otype: UserObject})
  expect(rmetas.get("chatq")).toEqual({type: "queue", mtype: "record"})

  const umetas = getPropMetas(UserObject.prototype)
  expect(umetas.get("username")).toEqual({type: "value", vtype: "string"})
  expect(umetas.get("lastLogin")).toEqual({type: "value", vtype: "timestamp"})
})

test("access", () => {
  const source = new TestDataSource()
  const user = new UserObject(source, ["users", "1"])
  expect(user.key).toEqual("1")

  const auth1 = {id: "1", isSystem: false}
  const auth2 = {id: "2", isSystem: false}
  const auths = {id: "system", isSystem: true}

  expect(user.canSubscribe(auth1)).toEqual(true)
  expect(user.canSubscribe(auth2)).toEqual(false)

  expect(user.canWrite("username", auth1)).toEqual(true)
  expect(user.canWrite("username", auths)).toEqual(true)

  expect(user.canWrite("lastLogin", auth1)).toEqual(false)
  expect(user.canWrite("lastLogin", auths)).toEqual(true)
})

test("codec", () => {
  const source = new TestDataSource()
  const path = ["rooms", "1"]
  const room = new RoomObject(source, path)
  room.name.update("Test room")
  room.occupants.set("1", {username: "Testy Testerson"})
  room.occupants.set("2", {username: "Sandy Clause"})
  room.nextMsgId.update(4)
  const now = Timestamp.now()
  room.messages.set(1, {sender: "1", sent: now-5*60*1000, text: "Yo Sandy!"})
  room.messages.set(2, {sender: "2", sent: now-3*60*1000, text: "Hiya Testy."})
  room.messages.set(3, {sender: "1", sent: now-1*60*1000, text: "How's the elves?"})

  const enc = new Encoder(new TextEncoder() as any)
  addObject(room, enc)

  const msg = enc.finish()
  const dec = new Decoder(msg.buffer, new TextDecoder() as any)
  const droom = getObject<RoomObject>(RoomObject, dec, source, path)

  expect(droom.name.current).toEqual(room.name.current)
  expect(Array.from(droom.occupants)).toEqual(Array.from(room.occupants))
  expect(droom.nextMsgId.current).toEqual(room.nextMsgId.current)
  expect(Array.from(droom.messages)).toEqual(Array.from(room.messages))
})
