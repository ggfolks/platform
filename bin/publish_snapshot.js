#!/usr/bin/env node

const {spawn} = require("child_process")
const package = require("../lib/package.json")

const {name, version} = package
const registry = package.publishConfig.registry

if (!name || !version || !registry) {
  console.warn("Missing data from package.json:")
  console.warn(`- name: '${name}'`)
  console.warn(`- version: '${version}'`)
  console.warn(`- registry: '${registry}'`)
  process.exit(255)
}

if (!version.endsWith("-snapshot")) {
  console.warn(`${name} version (${version}) does not end with '-snapshot'. Aborting.`)
  process.exit(255)
}

const unpub = spawn("npm", ["unpublish", "--registry", registry, `${name}@${version}`],
                    {stdio: "inherit"})
unpub.on("exit", code => {
  if (code !== 0) console.warn(`Unpublish failed (code: ${code}), trying publish anyway...`)
  const pub = spawn("npm", ["publish", "lib"], {stdio: "inherit"})
  pub.on("exit", code => process.exit(code))
})
