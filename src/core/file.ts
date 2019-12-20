import {NoopRemover, log} from "./util"
import {Subject} from "./react"
import {ResourceLoader} from "./assets"
import * as fs from "fs"
import * as p from "path"

function readFile<R> (path :string, parse :(data :string) => R, disp :(r:R) => void) {
  fs.readFile(path, "utf8", (err, data) => {
    if (err) log.warn("Failed to load resource data", "path", path, err)
    else disp(parse(data))
  })
}

/** A resource loader that loads resources from the file system (via Node APIs) and optionally
  * watches them for changes and hot reloads them. */
export class FileResourceLoader extends ResourceLoader {

  constructor (baseUrl :string, readonly baseDir :string, readonly watch = false) { super(baseUrl) }

  loadResource<R> (path :string, parse :(data :string) => R) :Subject<R> {
    const filePath = p.join(this.baseDir, path)
    return Subject.deriveSubject(disp => {
      readFile(filePath, parse, disp)
      if (!this.watch) return NoopRemover
      const watcher = fs.watch(filePath, () => readFile(filePath, parse, disp))
      return () => watcher.close()
    })
  }
}
