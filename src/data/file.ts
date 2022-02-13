import * as P from "path"
import * as fs from "fs"
import {TextEncoder, TextDecoder} from "util"

import {UUID} from "../core/uuid"
import {Record} from "../core/data"
import {Mutable} from "../core/react"
import {MutableMap} from "../core/rcollect"
import {Path, PathMap} from "../core/path"
import {Encoder, Decoder, setTextCodec} from "../core/codec"
import {log} from "../core/util"
import {isPersist} from "./meta"
import {SyncMsg} from "./protocol"
import {DMutable, DObject, DObjectType} from "./data"
import {AbstractDataStore, Resolved, Resolver} from "./server"

const DebugLog = false

setTextCodec(() => new TextEncoder() as any, () => new TextDecoder() as any)

export function addObject (enc :Encoder, obj :DObject) {
  for (const meta of obj.metas) {
    if (!isPersist(meta)) continue
    const prop = obj[meta.name]
    switch (meta.type) {
    case "value":
      enc.addValue(meta.index, "size8")
      enc.addValue((prop as Mutable<any>).current, meta.vtype)
      break
    case "set":
      enc.addValue(meta.index, "size8")
      enc.addSet((prop as Set<any>), meta.etype)
      break
    case "map":
      enc.addValue(meta.index, "size8")
      enc.addMap((prop as Map<any, any>), meta.ktype, meta.vtype)
      break
    case "collection": break
    case "queue": break
    }
  }
  enc.addValue(255, "size8")
}

function getObject (dec :Decoder, into :DObject) :DObject {
  const errors :Error[] = []
  while (true) {
    const idx = dec.getValue("size8")
    if (idx === 255) break
    const meta = into.metas[idx]
    if (!meta) throw new Error(log.format("Missing object meta", "obj", into, "idx", idx))
    const prop = into[meta.name]
    switch (meta.type) {
    case "value":
      const nvalue = dec.getValue(meta.vtype)
      try { (prop as DMutable<any>).update(nvalue, true) }
      catch (err :any) { errors.push(err) }
      break
    case "set":
      dec.syncSet(meta.etype, (prop as Set<any>), errors)
      break
    case "map":
      dec.syncMap(meta.ktype, meta.vtype, (prop as Map<any, any>), errors)
      break
    case "collection": break // TODO: anything?
    case "queue": break // TODO: anything?
    }
  }
  // these are just application errors, not decoding errors, so log them and move on
  for (const err of errors) log.warn("Notify failure during object receive", "obj", into, err)
  return into
}

const pathToDir = (root :string, path :Path) => P.join(root, ...path)
const pathToFile = (root :string, path :Path, file :string) => P.join(pathToDir(root, path), file)

const readObject = async (file :string, into :DObject) => {
  try {
    const buffer = await fs.promises.readFile(file)
    const dec = new Decoder(buffer)
    getObject(dec, into)
  } catch (err :any) {
    if (err.code !== "ENOENT") throw err
  }
}

const writeObject = async (file :string, obj :DObject) => {
  const enc = new Encoder()
  addObject(enc, obj)
  const newFile = `${file}.new`
  await fs.promises.writeFile(newFile, enc.finish())
  return fs.promises.rename(newFile, file)
}

const readRecord = async (file :string) => {
  try {
    const buffer = await fs.promises.readFile(file)
    const dec = new Decoder(buffer)
    return dec.getValue("record")
  } catch (err :any) {
    if (err.code !== "ENOENT") throw err
    else return {}
  }
}

const writeRecord = async (file :string, rec :Record) => {
  const enc = new Encoder()
  enc.addValue(rec, "record")
  const newFile = `${file}.new`
  await fs.promises.writeFile(newFile, enc.finish())
  return fs.promises.rename(newFile, file)
}

class Syncer {
  needsFlush = false
  private needsDir = true
  constructor (readonly file :string, readonly object :DObject) {}

  async flush () {
    if (!this.needsFlush) return
    this.needsFlush = false
    if (this.needsDir) {
      this.needsDir = false
      try {
        await fs.promises.mkdir(P.dirname(this.file), {recursive: true})
      } catch (err) {
        log.warn("Failed to create parent for object", "file", this.file, err)
      }
    }
    try {
      if (DebugLog) log.info("Flushing object data", "file", this.file, "obj", this.object)
      await writeObject(this.file, this.object)
    } catch (err) {
      log.warn("Failed to write data for object", "file", this.file, err)
    }
  }
}

const DEFAULT_FLUSH_FREQ = 10 * 1000

export class FileDataStore extends AbstractDataStore {
  private readonly syncers = new PathMap<Syncer>()
  private readonly flushTimer :NodeJS.Timeout

  constructor (rtype :DObjectType<any>, readonly rootDir :string, flushFreq = DEFAULT_FLUSH_FREQ) {
    super(rtype)
    log.info("File datastore syncing every " + flushFreq/1000 + "s", "root", rootDir)
    this.flushTimer = setInterval(() => this.flushUpdates(), flushFreq)
    fs.promises.mkdir(rootDir, {recursive: true}).catch(err => {
      log.warn("Failed to create datastore root", "root", rootDir, err)
    })
  }

  async resolveData (res :Resolved, resolver? :Resolver) {
    const file = pathToFile(this.rootDir, res.object.path, "data.bin")
    const syncer = new Syncer(file, res.object)
    this.syncers.set(res.object.path, syncer)
    if (resolver) resolver(res.object)
    else try {
      await readObject(file, res.object)
    } catch (err) {
      log.warn("Failed to resolve data", "file", file, err)
    }
    res.resolvedData()
  }

  persistSync (obj :DObject, msg :SyncMsg) {
    const syncer = this.syncers.get(obj.path)
    if (!syncer) log.warn("Missing ref for sync persist", "obj", obj)
    else syncer.needsFlush = true
  }

  protected async resolveTableData (path :Path, table :MutableMap<UUID, Record>) {
    const dir = pathToDir(this.rootDir, path)
    try {
      await fs.promises.mkdir(dir, {recursive: true})
      if (DebugLog) log.info("Created directory for table", "tpath", path, "tdir", dir)
    } catch (err) {
      log.warn("Failed to create table directory", "dir", dir, err)
    }
    try {
      const keys = await fs.promises.readdir(dir)
      for (const key of keys) {
        if (!key.endsWith(".bin")) continue
        try {
          const data = await readRecord(P.join(dir, key))
          table.set(key.substring(0, key.length-5), data)
        } catch (err) {
          log.warn("Failed to read table record", "dir", dir, "key", key, err)
        }
      }
    } catch (err) {
      log.warn("Failed to read table directory", "dir", dir, err)
    }

    table.onChange(async (change) => {
      const file = pathToFile(this.rootDir, path, `${change.key}.bin`)
      switch (change.type) {
      case "set":
        if (DebugLog) log.info(
          "Writing table record", "table", path, "file", file, "data", change.value)
        try {
          await writeRecord(file, change.value)
        } catch (err) {
          log.warn("Failure writing table data", "file", file, err)
        }
        break
      case "deleted":
        if (DebugLog) log.info("Deleting table record", "table", path, "file", file)
        fs.unlink(file, err => {
          if (err && err.code !== "ENOENT") console.warn(err)
        })
        break
      }
    })
  }

  private flushUpdates () {
    this.syncers.forEach(syncer => syncer.flush())
  }

  shutdown () :Promise<void> {
    this.flushUpdates()
    clearInterval(this.flushTimer)
    // TODO: wait until writes are flushed...
    return Promise.resolve()
  }
}
