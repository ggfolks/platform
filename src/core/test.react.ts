import {Emitter, Mutable, Stream, Subject, Value} from "./react"

//
// Reactive stream tests

test("basic stream", () => {
  function testStream (stream :Stream<string>, emit :(v :string) => any) {
    const history :string[] = []
    const remover = stream.onValue(a => history.push(a))
    emit("a")
    expect(history).toEqual(["a"])
    emit("b")
    expect(history).toEqual(["a", "b"])
    emit("c")
    expect(history).toEqual(["a", "b", "c"])
    remover()
    emit("d")
    expect(history).toEqual(["a", "b", "c"])

    let mapHistory :number[] = []
    let mapRemover = stream.map(a => a.length).onValue(l => mapHistory.push(l))
    emit("ant")
    expect(mapHistory).toEqual([3])
    emit("bear")
    expect(mapHistory).toEqual([3, 4])
    emit("condor")
    expect(mapHistory).toEqual([3, 4, 6])
    mapRemover()
    emit("iguana")
    expect(mapHistory).toEqual([3, 4, 6])

    let filterHistory :string[] = []
    let filterRemover = stream.filter(b => b.length % 2 == 0).onValue(b => filterHistory.push(b))
    emit("one")
    expect(filterHistory).toEqual([])
    emit("five")
    expect(filterHistory).toEqual(["five"])
    emit("nineteen")
    expect(filterHistory).toEqual(["five", "nineteen"])
    emit("seven")
    expect(filterHistory).toEqual(["five", "nineteen"])
    filterRemover()
    emit("four")
    expect(filterHistory).toEqual(["five", "nineteen"])

    let onceCount = 0
    stream.next(c => onceCount++)
    emit("hello")
    expect(onceCount).toBe(1)
    emit("goodbye")
    expect(onceCount).toBe(1)
  }

  const em = new Emitter<string>()
  testStream(em, v => em.emit(v))

  const rv = Mutable.local("")
  testStream(rv.toStream(), v => rv.update(v))
})

test("merged stream", () => {
  const em1 = new Emitter<string>()
  const em2 = new Emitter<string>()
  const em3 = new Emitter<string>()
  const emm = Stream.merge(em1, em2, em3)

  let history :string[] = []
  emm.onValue(v => history.push(v))

  em1.emit("a")
  expect(history).toEqual(["a"])
  em2.emit("b")
  expect(history).toEqual(["a", "b"])
  em2.emit("b")
  expect(history).toEqual(["a", "b", "b"])
  em3.emit("c")
  expect(history).toEqual(["a", "b", "b", "c"])
  em1.emit("a")
  expect(history).toEqual(["a", "b", "b", "c", "a"])
})

//
// Reactive subject tests

test("basic subject", () => {
  function testSubject (subject :Subject<string>, update :(v :string) => any) {
    let onceCount = 0
    subject.next(c => onceCount++)
    update("hello")
    expect(onceCount).toBe(1)
    update("goodbye")
    expect(onceCount).toBe(1)

    const history :string[] = []
    subject.onValue(nv => history.push(nv))
    // we don't know if our subject retains values across observerlessness,
    // so we have to account for an empty history here or a size one history
    const exphistory = history.slice()

    update("a") ; exphistory.push("a")
    expect(history).toEqual(exphistory)
    update("b") ; exphistory.push("b")
    expect(history).toEqual(exphistory)
    update("c") ; exphistory.push("c")
    expect(history).toEqual(exphistory)

    let mapSubject = subject.map(a => a.length)
    let mapHistory :number[] = []
    let mapRemover = mapSubject.onValue(l => mapHistory.push(l))
    // our subject is still observed by the first history observer, so we know for sure that the
    // above onValue call will immediately append to mapHistory
    expect(mapHistory).toEqual([1])
    update("ant")
    expect(mapHistory).toEqual([1, 3])
    update("bear")
    expect(mapHistory).toEqual([1, 3, 4])
    update("condor")
    expect(mapHistory).toEqual([1, 3, 4, 6])
    mapRemover()
    update("iguanae")
    expect(mapHistory).toEqual([1, 3, 4, 6])

    let filterHistory :string[] = []
    let filterRemover = subject.when(b => b.length % 2 == 0, b => filterHistory.push(b))
    update("one")
    expect(filterHistory).toEqual([])
    update("five")
    expect(filterHistory).toEqual(["five"])
    update("nineteen")
    expect(filterHistory).toEqual(["five", "nineteen"])
    update("seven")
    expect(filterHistory).toEqual(["five", "nineteen"])
    filterRemover()
    update("four")
    expect(filterHistory).toEqual(["five", "nineteen"])
  }

  const rm = Mutable.local("")
  testSubject(rm.toSubject(), v => rm.update(v))

  const em = new Emitter<string>()
  testSubject(em.toSubject(), v => em.emit(v))
})

// regression test for bug where once() on constant subject choked
test("constant once", () => {
  const val = Value.constant("foo")
  val.once(v => expect(v).toEqual("foo"))

  const sub = Subject.constant("foo")
  sub.once(v => expect(v).toEqual("foo"))
})

//
// Reactive value tests

test("basic value", () => {
  function testValue (value :Value<string>, update :(v :string) => any) {
    let onceCount = 0
    value.next(c => onceCount++)
    update("hello")
    expect(onceCount).toBe(1)
    update("goodbye")
    expect(onceCount).toBe(1)

    let prev = value.current
    const history :string[] = []
    value.onChange((nv, ov) => {
      expect(ov).toEqual(prev)
      prev = nv
      history.push(nv)
    })

    update("a")
    expect(value.current).toEqual("a")
    expect(history).toEqual(["a"])
    update("b")
    expect(value.current).toEqual("b")
    expect(history).toEqual(["a", "b"])
    update("b")
    expect(value.current).toEqual("b")
    expect(history).toEqual(["a", "b"])
    update("c")
    expect(value.current).toEqual("c")
    expect(history).toEqual(["a", "b", "c"])

    let mapValue = value.map(a => a.length)
    expect(mapValue.current).toEqual(value.current.length)
    let mapHistory :number[] = []
    let mapRemover = mapValue.onValue(l => mapHistory.push(l))
    expect(mapHistory).toEqual([1])
    update("ant")
    expect(mapHistory).toEqual([1, 3])
    expect(mapValue.current).toEqual(value.current.length)
    update("bear")
    expect(mapHistory).toEqual([1, 3, 4])
    update("condor")
    expect(mapHistory).toEqual([1, 3, 4, 6])
    mapRemover()
    update("iguanae")
    expect(mapHistory).toEqual([1, 3, 4, 6])
    // make sure mapped values reflect changes to their underlying value even when they have no
    // listeners
    expect(mapValue.current).toEqual(value.current.length)

    let filterHistory :string[] = []
    let filterRemover = value.when(b => b.length % 2 == 0, b => filterHistory.push(b))
    update("one")
    expect(filterHistory).toEqual([])
    update("five")
    expect(filterHistory).toEqual(["five"])
    update("nineteen")
    expect(filterHistory).toEqual(["five", "nineteen"])
    update("seven")
    expect(filterHistory).toEqual(["five", "nineteen"])
    filterRemover()
    update("four")
    expect(filterHistory).toEqual(["five", "nineteen"])
  }

  const rm = Mutable.local("")
  testValue(rm, v => rm.update(v))

  const em = new Emitter<string>()
  testValue(Value.fromStream(em, ""), v => em.emit(v))
})

test("value as promise", () => {
  // exercise the "the value already meets the promise criteria" code path
  let rez1 = false
  const rm1 = Mutable.local(3)
  rm1.toPromise(baz => baz === 3).then(baz => {
    expect(baz).toBe(3)
    rez1 = true
  })

  // exercise the "the value eventually meets the promise criteria" code path
  let rez2 = false
  const rm2 = Mutable.local("bar")
  const rm2p = rm2.toPromise(bar => bar === "bang!")
  const rm2pp = rm2p.then(bar => {
    expect(bar).toEqual("bang!")
    rez2 = true
    return true
  })
  rm2.update("pow!")
  expect(rez2).toBe(false)
  rm2.update("bang!")

  return rm2pp.then(rez => {
    // this is playing a little fast and loose with promise resolution, in that we expect the baz
    // promise to resolve by the time the bar promise is resolved, but we're not really doing
    // anything async here except Node's built in "defer any promise resolution to the next event
    // tick" policy
    expect(rez1).toBe(true)
    expect(rez2).toBe(true)
    expect(rez).toBe(true)
  })
})

test("switch mapped values", () => {
  const useBar = Mutable.local(false)
  const bar = Mutable.local("")
  const baz = Mutable.local("")
  const barOrBaz = useBar.switchMap(useBar => useBar ? bar : baz)
  const barOrBazLength = barOrBaz.map(v => v.length)

  const history :string[] = []
  barOrBaz.onValue(len => history.push(len))
  const lenHistory :number[] = []
  barOrBazLength.onValue(len => lenHistory.push(len))

  const useBarValues = [false, false, true,    true,   false]
  const barValues    = ["one", "two", "three", "four", "five"]
  const bazValues    = ["aye", "bee", "see",   "dee",  "eeeek!"]
  for (let ii = 0; ii < useBarValues.length; ii += 1) {
    useBar.update(useBarValues[ii])
    bar.update(barValues[ii])
    baz.update(bazValues[ii])
  }

  // make sure we emitted the right values; note that because useBar is updated first, we will
  // transition from the bar value to the baz value (or vice versa) when useBar changes and only
  // after that, emit the updated bar or baz value
  expect(history).toEqual(["", "aye", "bee", "two", "three", "four", "dee", "eeeek!"])
  // make sure we only emitted lengths when it changed
  expect(lenHistory).toEqual([0, 3, 5, 4, 3, 6])

  // make sure switch mapped values reflect changes to their underlying values even when they have
  // no listeners
  const anotherBarOrBaz = useBar.switchMap(useBar => useBar ? bar : baz)
  useBar.update(false)
  expect(anotherBarOrBaz.current).toEqual(baz.current)
  baz.update("hello")
  expect(anotherBarOrBaz.current).toEqual(baz.current)
  useBar.update(true)
  expect(anotherBarOrBaz.current).toEqual(bar.current)
  bar.update("goodbye")
  expect(anotherBarOrBaz.current).toEqual(bar.current)
})

test("joined values", () => {
  const foo = Mutable.local(true)
  const bar = Mutable.local("")
  const baz = Mutable.local(0)

  const history :Array<[boolean, string, number]> = []
  Value.join3(foo, bar, baz).onValue(fbb => history.push([...fbb] as [boolean, string, number]))

  // make some changes
  foo.update(false)
  foo.update(false)
  bar.update("yay")
  baz.update(42)
  bar.update("yay")
  baz.update(42)
  foo.update(true)

  // check that the emitted value history matches our expectations
  expect(history).toEqual([
    [true,  "",     0],
    [false, "",     0],
    [false, "yay",  0],
    [false, "yay", 42],
    [true,  "yay", 42],
  ])

  // make sure joined values reflect changes to their underlying values even when they have no
  // listeners
  let fooBarBaz = Value.join3(foo, bar, baz)
  expect(fooBarBaz.current).toEqual([true, "yay", 42])
  foo.update(false)
  expect(fooBarBaz.current).toEqual([false, "yay", 42])
  bar.update("boo")
  expect(fooBarBaz.current).toEqual([false, "boo", 42])
  baz.update(13)
  expect(fooBarBaz.current).toEqual([false, "boo", 13])
})

test("bimapped values", () => {
  const data = {foo: "foo", bar: {baz: 3, berry: false}}
  const obj = Mutable.localData(data)
  const objhist :Array<typeof data> = []
  obj.onValue(v => objhist.push(v))

  const xobjhist = [data]
  expect(objhist).toEqual(xobjhist)

  const foo = obj.bimap(o => o.foo, (o, foo) => ({...o, foo}))
  const foohist :string[] = []
  foo.onValue(f => foohist.push(f))

  const xfoohist = [data.foo]
  expect(foohist).toEqual(xfoohist)

  foo.update("foozle")
  xfoohist.push("foozle")
  expect(foohist).toEqual(xfoohist)
  xobjhist.push({...data, foo: "foozle"})
  expect(objhist).toEqual(xobjhist)

  const bar = obj.bimap(o => o.bar, (o, bar) => ({...o, bar}))
  const barhist :Array<typeof data.bar> = []
  bar.onValue(b => barhist.push(b))

  const xbarhist = [data.bar]
  expect(barhist).toEqual(xbarhist)

  const baz = bar.bimap(b => b.baz, (b, baz) => ({...b, baz}))
  const bazhist :number[] = []
  baz.onValue(b => bazhist.push(b))

  const xbazhist = [data.bar.baz]
  expect(bazhist).toEqual(xbazhist)

  baz.update(5)
  xbazhist.push(5)
  expect(bazhist).toEqual(xbazhist)

  xobjhist.push({...data, foo: "foozle", bar: {...data.bar, baz: 5}})
  expect(objhist).toEqual(xobjhist)
})
