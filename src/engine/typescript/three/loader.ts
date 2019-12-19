import {FileLoader} from "three"
import {Noop, NoopRemover, log} from "../../../core/util"
import {ResourceLoader} from "../../../core/assets"
import {Subject} from "../../../core/react"

export class ThreeResourceLoader extends ResourceLoader {

  protected loadResource<R> (path :string, parse :(data :string) => R) :Subject<R> {
    const url = this.getUrl(path)
    return Subject.deriveSubject(disp => {
      const loader = new FileLoader()
      loader.load(url, data => disp(parse(data as string)), Noop, err => {
        log.warn("Failed to load resource data", "url", url, err)
      })
      return NoopRemover
    })
  }
}
