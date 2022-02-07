/*
 * Copyright (C) 2018-2021 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { DeleteSecretCommand, DeleteEnvironmentCommand, DeleteServiceCommand } from "../../../../src/commands/delete"
import {
  expectError,
  makeTestGardenA,
  getDataDir,
  configureTestModule,
  withDefaultGlobalOpts,
  makeTestGarden,
} from "../../../helpers"
import { expect } from "chai"
import { ServiceStatus } from "../../../../src/types/service"
import { EnvironmentStatus } from "../../../../src/types/plugin/provider/getEnvironmentStatus"
import { DeleteServiceParams } from "../../../../src/types/plugin/service/deleteService"
import { createGardenPlugin } from "../../../../src/types/plugin/plugin"
import { testModuleSpecSchema } from "../../../helpers"

describe("DeleteSecretCommand", () => {
  const pluginName = "test-plugin"
  const provider = pluginName

  it("should delete a secret", async () => {
    const garden = await makeTestGardenA()
    const log = garden.log
    const command = new DeleteSecretCommand()

    const key = "mykey"
    const value = "myvalue"

    const actions = await garden.getActionRouter()
    await actions.setSecret({ log, key, value, pluginName })

    await command.action({
      garden,
      log,
      headerLog: log,
      footerLog: log,
      args: { provider, key },
      opts: withDefaultGlobalOpts({}),
    })

    expect(await actions.getSecret({ log, pluginName, key })).to.eql({
      value: null,
    })
  })

  it("should throw on missing key", async () => {
    const garden = await makeTestGardenA()
    const log = garden.log
    const command = new DeleteSecretCommand()

    await expectError(
      async () =>
        await command.action({
          garden,
          log,
          headerLog: log,
          footerLog: log,
          args: { provider, key: "foo" },
          opts: withDefaultGlobalOpts({}),
        }),
      "not-found"
    )
  })

  it("should be protected", async () => {
    const command = new DeleteSecretCommand()
    expect(command.protected).to.be.true
  })
})

const getServiceStatus = async (): Promise<ServiceStatus> => {
  return { state: "ready", detail: {} }
}

describe("DeleteEnvironmentCommand", () => {
  let deletedServices: string[] = []
  const testEnvStatuses: { [key: string]: EnvironmentStatus } = {}

  const testProvider = createGardenPlugin({
    name: "test-plugin",
    handlers: {
      cleanupEnvironment: async ({ ctx }) => {
        testEnvStatuses[ctx.environmentName] = { ready: false, outputs: {} }
        return {}
      },
      getEnvironmentStatus: async ({ ctx }) => {
        return testEnvStatuses[ctx.environmentName] || { ready: true, outputs: {} }
      },
    },
    createModuleTypes: [
      {
        name: "test",
        docs: "Test plugin",
        schema: testModuleSpecSchema(),
        handlers: {
          configure: configureTestModule,
          getServiceStatus,
          deleteService: async ({ service }): Promise<ServiceStatus> => {
            deletedServices.push(service.name)
            return { state: "missing", detail: {} }
          },
        },
      },
    ],
  })

  beforeEach(() => {
    deletedServices = []
  })

  const projectRootB = getDataDir("test-project-b")
  const command = new DeleteEnvironmentCommand()
  const plugins = [testProvider]

  it("should delete environment with services", async () => {
    const garden = await makeTestGarden(projectRootB, { plugins })
    const log = garden.log

    const { result } = await command.action({
      garden,
      log,
      footerLog: log,
      headerLog: log,
      args: {},
      opts: withDefaultGlobalOpts({}),
    })

    expect(command.outputsSchema().validate(result).error).to.be.undefined

    expect(result!.providerStatuses["test-plugin"]["ready"]).to.be.false
    expect(result!.serviceStatuses).to.eql({
      "service-a": { forwardablePorts: [], state: "missing", detail: {}, outputs: {} },
      "service-b": { forwardablePorts: [], state: "missing", detail: {}, outputs: {} },
      "service-c": { forwardablePorts: [], state: "missing", detail: {}, outputs: {} },
      "service-d": { forwardablePorts: [], state: "missing", detail: {}, outputs: {} },
    })
    expect(deletedServices.sort()).to.eql(["service-a", "service-b", "service-c", "service-d"])
  })

  it("should be protected", async () => {
    expect(command.protected).to.be.true
  })
})

describe("DeleteServiceCommand", () => {
  const testStatuses: { [key: string]: ServiceStatus } = {
    "service-a": {
      state: "unknown",
      ingresses: [],
      detail: {},
    },
    "service-b": {
      state: "unknown",
      ingresses: [],
      detail: {},
    },
    "service-c": {
      state: "unknown",
      ingresses: [],
      detail: {},
    },
    "service-d": {
      state: "unknown",
      ingresses: [],
      detail: {},
    },
  }

  const testProvider = createGardenPlugin({
    name: "test-plugin",
    createModuleTypes: [
      {
        name: "test",
        docs: "Test plugin",
        schema: testModuleSpecSchema(),
        handlers: {
          configure: configureTestModule,
          getServiceStatus,
          deleteService: async (param: DeleteServiceParams) => {
            return testStatuses[param.service.name]
          },
        },
      },
    ],
  })

  const plugins = [testProvider]

  const command = new DeleteServiceCommand()
  const projectRootB = getDataDir("test-project-b")

  it("should return the status of the deleted service", async () => {
    const garden = await makeTestGarden(projectRootB, { plugins })
    const log = garden.log

    const { result } = await command.action({
      garden,
      log,
      headerLog: log,
      footerLog: log,
      args: { services: ["service-a"] },
      opts: withDefaultGlobalOpts({}),
    })

    expect(command.outputsSchema().validate(result).error).to.be.undefined

    expect(result).to.eql({
      "service-a": { forwardablePorts: [], state: "unknown", ingresses: [], detail: {}, outputs: {} },
    })
  })

  it("should return the status of the deleted services", async () => {
    const garden = await makeTestGarden(projectRootB, { plugins })
    const log = garden.log

    const { result } = await command.action({
      garden,
      log,
      headerLog: log,
      footerLog: log,
      args: { services: ["service-a", "service-b"] },
      opts: withDefaultGlobalOpts({}),
    })
    expect(result).to.eql({
      "service-a": { forwardablePorts: [], state: "unknown", ingresses: [], detail: {}, outputs: {} },
      "service-b": { forwardablePorts: [], state: "unknown", ingresses: [], detail: {}, outputs: {} },
    })
  })

  it("should delete all services if none are specified", async () => {
    const garden = await makeTestGarden(projectRootB, { plugins })
    const log = garden.log

    const { result } = await command.action({
      garden,
      log,
      headerLog: log,
      footerLog: log,
      args: { services: undefined },
      opts: withDefaultGlobalOpts({}),
    })
    expect(result).to.eql({
      "service-a": { forwardablePorts: [], state: "unknown", ingresses: [], detail: {}, outputs: {} },
      "service-b": { forwardablePorts: [], state: "unknown", ingresses: [], detail: {}, outputs: {} },
      "service-c": { forwardablePorts: [], state: "unknown", ingresses: [], detail: {}, outputs: {} },
      "service-d": { forwardablePorts: [], state: "unknown", ingresses: [], detail: {}, outputs: {} },
    })
  })

  it("should be protected", async () => {
    expect(command.protected).to.be.true
  })
})
