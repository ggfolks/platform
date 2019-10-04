import {uuidv1} from "../core/uuid"
import {RunQueue, TestClient} from "../channel/test.channel"
import {getMethodMetas, rservice, rcall, rreq} from "./meta"
import {RProtocol, ImplOf, serviceHandler, resolveService} from "./rpc"

@rservice
class TestProtocol extends RProtocol {

  @rcall("string", "size16")
  testCall (name :string, age :number) :void { return this.stub() }

  @rreq(["string", "size16"], "string")
  testReq (text :string, length :number) :Promise<string> { return this.stub() }
}

class TestImpl implements ImplOf<TestProtocol> {

  calls :{name:string, year:number}[] = []
  disposed = false

  testCall (name :string, year :number) {
    this.calls.push({name, year})
    // console.log(`testCall ${name} ${year}`)
  }

  testReq (text :string, length :number) :Promise<string> {
    const res = text.length > length ? "longer" : "not longer"
    // console.log(`testReq ${text} ${length} => ${res}`)
    return Promise.resolve(res)
  }

  dispose () {
    this.disposed = true
  }
}

test("metas", () => {
  const rmetas = getMethodMetas(TestProtocol.prototype)
  expect(rmetas[0]).toEqual({
    type: "call", name: "testCall", index: 0, args: ["string", "size16"]})
  expect(rmetas[1]).toEqual({
    type: "req", name: "testReq", index: 1, args: ["string", "size16"], rval: "string"})
})

test("service", done => {
  const ida = uuidv1()
  const queue :RunQueue = new RunQueue()
  const authA = {source: "guest", id: ida, token: ""}

  const impl = new TestImpl()
  const client = new TestClient(authA, queue, serviceHandler([{
    protocol: TestProtocol,
    open: (auth, path) => Promise.resolve(impl)
  }]))

  const test = resolveService(client.manager, [], TestProtocol)

  let reqRes = ""
  test.testCall("Elvis", 1935)
  test.testCall("Madonna", 1958)
  test.testReq("twenty five", 25).then(r => reqRes = r)

  queue.process(() => {
    expect(impl.calls).toStrictEqual([{name: "Elvis", year: 1935}, {name: "Madonna", year: 1958}])
    expect(reqRes).toBe("not longer")

    test.dispose()
    queue.process(() => {
      expect(impl.disposed).toBe(true)
      done()
    })
  })
})
