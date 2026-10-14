import { readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeFunctionData,
  encodeFunctionResult,
  encodeErrorResult,
  encodeEventTopics,
  encodeAbiParameters,
  parseAbiParameters,
  toHex,
  parseTransaction,
  recoverTransactionAddress,
  keccak256,
  zeroAddress,
} from "viem";
export const root = fileURLToPath(new URL("../../", import.meta.url));
export const dist = resolve(root, "dist");
export const deployment = JSON.parse(
  readFileSync(resolve(dist, "imd-deployment.json"), "utf8"),
);
export const abis = Object.fromEntries(
  [
    "HandlerDesk",
    "HandlerArt",
    "HandlerCards",
    "LaunchToken",
    "ERC20",
    "Permit2",
    "Quoter",
    "UniversalRouter",
  ].map((n) => [
    n,
    JSON.parse(readFileSync(resolve(dist, `abi/${n}.json`), "utf8")),
  ]),
);
export const ADDR = {
  desk: deployment.contracts.find((c) => c.name === "HandlerDesk").address,
  hic: deployment.contracts.find((c) => c.name === "LaunchToken").address,
  art: deployment.contracts.find((c) => c.name === "HandlerArt").address,
  imd: deployment.network.pairToken.address,
  ...deployment.network.uniswapV4,
  // Test-only wallets and child contract. These never enter the runtime deployment configuration.
  holder: "0x1111111111111111111111111111111111111111",
  agent: "0x2222222222222222222222222222222222222222",
  other: "0x3333333333333333333333333333333333333333",
  cards: "0x4444444444444444444444444444444444444444",
};
export const E = 10n ** 18n;
export function fixture() {
  const time = BigInt(Math.floor(Date.now() / 1000));
  const make = (name, agent, wins, losses) => ({
    name,
    agent,
    frozen: false,
    dailyCap: 50n * E,
    maxPerTrade: 10n * E,
    day: time / 86400n,
    spentToday: 0n,
    mintedAt: time - 86400n,
    trades: wins + losses + 7n,
    wins,
    losses,
    pnl: 12n * E,
    volume: 182n * E,
  });
  return {
    time,
    block: 26182000n,
    account: ADDR.holder,
    chain: "0x1",
    unknownChain: false,
    connectReject: false,
    rejectNext: false,
    revertNext: "",
    rpcOffline: false,
    codeMissing: false,
    txDelay: 0,
    pending: false,
    cards: [
      { id: 1n, holder: ADDR.holder, ...make("Atlas", ADDR.agent, 16n, 9n) },
      {
        id: 2n,
        holder: ADDR.other,
        ...make("Other handler", ADDR.other, 12n, 5n),
      },
    ],
    balances: new Map([
      [`1:${ADDR.imd}`, 100n * E],
      [`1:${ADDR.hic}`, 5n * E],
      [`2:${ADDR.imd}`, 987654321n * E],
    ]),
    allowances: new Map(),
    permits: new Map(),
    walletBalance: 1000n * E,
    ethBalances: new Map(),
    agentWrites: [],
    rpcPayloads: [],
    mintPrice: E / 5n,
    owner: ADDR.holder,
    pendingOwner: zeroAddress,
    burnImd: 5n * E,
    hasBurned: false,
    lastBurnTime: 0n,
    writes: [],
    requests: [],
    simulations: [],
    receipts: new Map(),
    nonce: 0,
  };
}
export async function server() {
  const mime = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".txt": "text/plain",
    ".md": "text/plain",
  };
  const http = createServer((req, res) => {
    try {
      const path = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      if (!path.startsWith("/preview/")) {
        res.writeHead(404).end();
        return;
      }
      const file = resolve(
        dist,
        path.slice("/preview/".length) || "index.html",
      );
      if (!file.startsWith(dist + sep)) {
        res.writeHead(403).end();
        return;
      }
      res.setHeader(
        "Content-Type",
        mime[extname(file)] || "application/octet-stream",
      );
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => http.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${http.address().port}/preview/`,
    close: () => new Promise((r) => http.close(r)),
  };
}
function abiFor(to) {
  const a = to.toLowerCase();
  return a === ADDR.desk
    ? abis.HandlerDesk
    : a === ADDR.cards
      ? abis.HandlerCards
      : a === ADDR.quoter
        ? abis.Quoter
        : a === ADDR.permit2
          ? abis.Permit2
          : a === ADDR.universalRouter
            ? abis.UniversalRouter
            : abis.ERC20;
}
const balKey = (id, token) => `${id}:${token.toLowerCase()}`;
const allowKey = (owner, token, spender) =>
  `${owner.toLowerCase()}:${token.toLowerCase()}:${spender.toLowerCase()}`;
const card = (s, id) => {
  const c = s.cards.find((c) => c.id === id);
  if (!c) throw Error("UnknownCard");
  return c;
};
export function block(s, n = s.block) {
  return {
    number: toHex(n),
    hash: "0x" + "ab".repeat(32),
    parentHash: "0x" + "cd".repeat(32),
    timestamp: toHex(s.time - (s.block - n) * 12n),
    nonce: "0x0000000000000000",
    difficulty: "0x0",
    totalDifficulty: "0x0",
    gasLimit: "0x1c9c380",
    gasUsed: "0x5208",
    miner: ADDR.holder,
    extraData: "0x",
    baseFeePerGas: "0x3b9aca00",
    logsBloom: "0x" + "00".repeat(256),
    mixHash: "0x" + "00".repeat(32),
    sha3Uncles: "0x" + "00".repeat(32),
    transactionsRoot: "0x" + "00".repeat(32),
    stateRoot: "0x" + "00".repeat(32),
    receiptsRoot: "0x" + "00".repeat(32),
    size: "0x1",
    uncles: [],
    transactions: [],
  };
}
function readCall(s, tx) {
  const abi = abiFor(tx.to),
    { functionName: fn, args = [] } = decodeFunctionData({
      abi,
      data: tx.data,
    });
  const to = tx.to.toLowerCase();
  let value;
  if (to === ADDR.desk) {
    const c =
      args[0] !== undefined &&
      typeof args[0] === "bigint" &&
      ["getCard", "spentToday", "balances", "positions", "cardCoins"].includes(
        fn,
      )
        ? card(s, args[0])
        : null;
    switch (fn) {
      case "hic":
        value = ADDR.hic;
        break;
      case "IMD":
        value = ADDR.imd;
        break;
      case "POOL_MANAGER":
        value = ADDR.poolManager;
        break;
      case "poolKey":
        value = deployment.poolKey;
        break;
      case "cards":
        value = ADDR.cards;
        break;
      case "mintPrice":
        value = s.mintPrice;
        break;
      case "totalCards":
        value = BigInt(s.cards.length);
        break;
      case "burnImd":
        value = s.burnImd;
        break;
      case "lastBurnTime":
        value = s.lastBurnTime;
        break;
      case "hasBurned":
        value = s.hasBurned;
        break;
      case "owner":
        value = s.owner;
        break;
      case "pendingOwner":
        value = s.pendingOwner;
        break;
      case "isTradable":
        value = args[0].toLowerCase() === ADDR.hic;
        break;
      case "getCard":
        value = c;
        break;
      case "spentToday":
        value = c.spentToday;
        break;
      case "cardCoins":
        value = [ADDR.imd, ADDR.hic];
        break;
      case "balances":
        value = s.balances.get(balKey(args[0], args[1])) ?? 0n;
        break;
      case "positions":
        value = [s.balances.get(balKey(args[0], args[1])) ?? 0n, E];
        break;
      default:
        s.simulations.push({ fn, args, to });
        if (s.revertNext === fn)
          throw {
            data: encodeErrorResult({
              abi: abis.HandlerDesk,
              errorName: "Slippage",
            }),
          };
        value =
          fn === "mint"
            ? BigInt(s.cards.length + 1)
            : ["buy", "sell", "buyAndBurn"].includes(fn)
              ? E
              : undefined;
    }
  } else if (to === ADDR.cards) {
    switch (fn) {
      case "desk":
        value = ADDR.desk;
        break;
      case "art":
        value = ADDR.art;
        break;
      case "ownerOf":
        value = card(s, args[0]).holder;
        break;
      case "tokenURI":
        value =
          "data:application/json;base64," +
          Buffer.from(
            JSON.stringify({
              image:
                "data:image/svg+xml;base64," +
                Buffer.from(
                  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#f2f1ec"/><text x="20" y="40">On-chain test card</text></svg>',
                ).toString("base64"),
            }),
          ).toString("base64");
        break;
      default:
        throw Error("Unknown card method " + fn);
    }
  } else if (to === ADDR.quoter) {
    s.simulations.push({ fn, args, to });
    value = [args[0].exactAmount * 2n, 50000n];
  } else if (to === ADDR.permit2) {
    if (fn === "allowance")
      value = s.permits.get(allowKey(args[0], args[1], args[2])) ?? [0n, 0, 0];
    else {
      s.simulations.push({ fn, args, to });
      value = undefined;
    }
  } else if (to === ADDR.universalRouter) {
    s.simulations.push({ fn, args, to });
    if (s.revertNext === "execute")
      throw {
        data: encodeErrorResult({
          abi: abis.HandlerDesk,
          errorName: "Slippage",
        }),
      };
    value = undefined;
  } else {
    switch (fn) {
      case "symbol":
        value = to === ADDR.imd ? "IMD" : "HIC";
        break;
      case "decimals":
        value = 18;
        break;
      case "balanceOf":
        value = s.walletBalance;
        break;
      case "allowance":
        value = s.allowances.get(allowKey(args[0], to, args[1])) ?? 0n;
        break;
      case "approve":
      case "transfer":
        s.simulations.push({ fn, args, to });
        value = true;
        break;
      default:
        throw Error("Unknown token call " + fn);
    }
  }
  return encodeFunctionResult({ abi, functionName: fn, result: value });
}
export async function rpc(s, req) {
  const { method, params = [] } = req;
  s.requests.push(method);
  s.rpcPayloads.push(req);
  if (s.rpcOffline) throw Error("Mock RPC unavailable");
  switch (method) {
    case "eth_chainId":
      return "0x1";
    case "eth_getBalance":
      return toHex(s.ethBalances.get(params[0].toLowerCase()) ?? 0n);
    case "eth_maxPriorityFeePerGas":
      return "0x3b9aca00";
    case "eth_sendRawTransaction": {
      const tx = parseTransaction(params[0]);
      const from = await recoverTransactionAddress({
        serializedTransaction: params[0],
      });
      const decoded = decodeFunctionData({
        abi: abis.HandlerDesk,
        data: tx.data,
      });
      const [id, token, value, minOut] = decoded.args;
      const current = card(s, id);
      if (from.toLowerCase() !== current.agent.toLowerCase() || current.frozen)
        throw Error("Agent forbidden");
      const isBuy = decoded.functionName === "buy";
      s.agentWrites.push({ ...decoded, from, to: tx.to, chainId: tx.chainId });
      const tokenAmount = isBuy ? (value - value / 400n) * 2n : value;
      const imdAmount = isBuy ? value : value * 2n - (value * 2n) / 400n;
      if ((isBuy ? tokenAmount : imdAmount) < minOut) throw Error("Slippage");
      const tokenKey = balKey(id, token),
        imdKey = balKey(id, ADDR.imd);
      s.balances.set(
        tokenKey,
        (s.balances.get(tokenKey) ?? 0n) + (isBuy ? tokenAmount : -tokenAmount),
      );
      s.balances.set(
        imdKey,
        (s.balances.get(imdKey) ?? 0n) + (isBuy ? -imdAmount : imdAmount),
      );
      current.trades++;
      if (isBuy) current.spentToday += value;
      else current.wins++;
      const hash = keccak256(params[0]);
      s.block++;
      s.nonce++;
      s.receipts.set(hash, {
        transactionHash: hash,
        transactionIndex: "0x0",
        blockHash: "0x" + "ab".repeat(32),
        blockNumber: toHex(s.block),
        from,
        to: tx.to,
        cumulativeGasUsed: "0x186a0",
        gasUsed: "0x186a0",
        contractAddress: null,
        logs: [],
        logsBloom: "0x" + "00".repeat(256),
        status: "0x1",
        effectiveGasPrice: "0x3b9aca00",
        type: "0x2",
      });
      return hash;
    }
    case "eth_blockNumber":
      return toHex(s.block);
    case "eth_getCode":
      return s.codeMissing ? "0x" : "0x60006000";
    case "eth_getBlockByNumber":
      return block(s, params[0] === "latest" ? s.block : BigInt(params[0]));
    case "eth_call":
      return readCall(s, params[0]);
    case "eth_getTransactionReceipt":
      return s.pending ? null : (s.receipts.get(params[0]) ?? null);
    case "eth_getLogs":
      return (s.logs ?? []).filter(
        (log) =>
          BigInt(log.blockNumber) >= BigInt(params[0].fromBlock) &&
          BigInt(log.blockNumber) <= BigInt(params[0].toBlock),
      );
    case "eth_getTransactionCount":
      return toHex(s.nonce);
    case "eth_gasPrice":
      return "0x3b9aca00";
    case "eth_estimateGas":
      return "0x186a0";
    default:
      throw Error("Unhandled mock RPC " + method);
  }
}
export async function attach(page, s, { wallet = true } = {}) {
  await page.route("https://**/*", async (route) => {
    const url = route.request().url();
    if (
      ![
        ...deployment.network.rpcUrls,
        "https://rpc.flashbots.net",
        "https://rpc.mevblocker.io",
      ].some((r) => url.startsWith(r))
    )
      return route.abort();
    if (s.rpcOffline) return route.abort();
    try {
      const payload = route.request().postDataJSON();
      const one = async (req) => {
        try {
          return { jsonrpc: "2.0", id: req.id, result: await rpc(s, req) };
        } catch (e) {
          return {
            jsonrpc: "2.0",
            id: req.id,
            error: {
              code: 3,
              message: e.message || "execution reverted",
              data: e.data,
            },
          };
        }
      };
      const body = Array.isArray(payload)
        ? await Promise.all(payload.map(one))
        : await one(payload);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    } catch (e) {
      await route.abort();
    }
  });
  if (!wallet) return;
  await page.exposeFunction("__walletRequest", async (req) => {
    s.requests.push(req.method);
    switch (req.method) {
      case "eth_requestAccounts":
        if (s.connectReject)
          return { error: { code: 4001, message: "User rejected connection" } };
        return { result: [s.account] };
      case "eth_accounts":
        return { result: [s.account] };
      case "eth_chainId":
        return { result: s.chain };
      case "wallet_switchEthereumChain":
        if (s.unknownChain)
          return { error: { code: 4902, message: "Unknown chain" } };
        s.chain = req.params[0].chainId;
        return { result: null, event: ["chainChanged", s.chain] };
      case "wallet_addEthereumChain":
        s.addChain = req.params[0];
        s.unknownChain = false;
        return { result: null };
      case "eth_sendTransaction": {
        if (s.txDelay) await new Promise((r) => setTimeout(r, s.txDelay));
        if (s.rejectNext) {
          s.rejectNext = false;
          return {
            error: { code: 4001, message: "User rejected transaction" },
          };
        }
        const tx = req.params[0];
        const decoded =
          tx.data && tx.data !== "0x"
            ? decodeFunctionData({
                abi: abiFor(tx.to),
                data: tx.data,
              })
            : { functionName: "nativeTransfer", args: [] };
        const { functionName: fn, args = [] } = decoded;
        s.writes.push({ ...decoded, to: tx.to.toLowerCase(), value: tx.value });
        const to = tx.to.toLowerCase();
        const hash = "0x" + (++s.nonce).toString(16).padStart(64, "0");
        s.block++;
        if (fn === "nativeTransfer")
          s.ethBalances.set(
            to,
            (s.ethBalances.get(to) ?? 0n) + BigInt(tx.value),
          );
        if (fn === "approve" && to !== ADDR.permit2)
          s.allowances.set(allowKey(s.account, to, args[0]), args[1]);
        if (fn === "approve" && to === ADDR.permit2)
          s.permits.set(allowKey(s.account, args[0], args[1]), [
            args[2],
            args[3],
            0,
          ]);
        if (to === ADDR.desk) {
          const c =
            typeof args[0] === "bigint" &&
            [
              "deposit",
              "withdraw",
              "setAgent",
              "setRules",
              "freeze",
              "unfreeze",
              "rename",
              "buy",
              "sell",
            ].includes(fn)
              ? card(s, args[0])
              : null;
          if (fn === "mint") {
            const newCard = {
              ...s.cards[0],
              id: BigInt(s.cards.length + 1),
              name: args[0],
              holder: s.account,
              agent: zeroAddress,
              dailyCap: 0n,
              maxPerTrade: 0n,
              spentToday: 0n,
              wins: 0n,
              losses: 0n,
              trades: 0n,
              pnl: 0n,
              volume: 0n,
              mintedAt: s.time,
            };
            s.cards.push(newCard);
            s.allowances.set(allowKey(s.account, ADDR.imd, ADDR.desk), 0n);
          }
          if (fn === "deposit") {
            const k = balKey(args[0], ADDR.imd);
            s.balances.set(k, (s.balances.get(k) ?? 0n) + args[1]);
            s.allowances.set(allowKey(s.account, ADDR.imd, ADDR.desk), 0n);
          }
          if (fn === "withdraw") {
            const k = balKey(args[0], args[1]);
            s.balances.set(k, (s.balances.get(k) ?? 0n) - args[2]);
          }
          if (fn === "setAgent") c.agent = args[1];
          if (fn === "setRules") {
            c.dailyCap = args[1];
            c.maxPerTrade = args[2];
          }
          if (fn === "freeze") c.frozen = true;
          if (fn === "unfreeze") c.frozen = false;
          if (fn === "rename") c.name = args[1];
          if (fn === "setMintPrice") s.mintPrice = args[0];
          if (fn === "transferOwnership") s.pendingOwner = args[0];
          if (fn === "acceptOwnership") {
            s.owner = s.account;
            s.pendingOwner = zeroAddress;
          }
          if (fn === "buyAndBurn") {
            s.burnImd = 0n;
            s.hasBurned = true;
            s.lastBurnTime = s.time;
          }
        }
        const receipt = {
          transactionHash: hash,
          transactionIndex: "0x0",
          blockHash: "0x" + "ab".repeat(32),
          blockNumber: toHex(s.block),
          from: s.account,
          to: tx.to,
          cumulativeGasUsed: "0x186a0",
          gasUsed: "0x186a0",
          contractAddress: null,
          logs:
            fn === "mint" && to === ADDR.desk
              ? [
                  {
                    address: ADDR.desk,
                    blockNumber: toHex(s.block),
                    blockHash: "0x" + "ab".repeat(32),
                    transactionHash: hash,
                    transactionIndex: "0x0",
                    logIndex: "0x0",
                    removed: false,
                    topics: encodeEventTopics({
                      abi: abis.HandlerDesk,
                      eventName: "Minted",
                      args: { id: BigInt(s.cards.length), holder: s.account },
                    }),
                    data: encodeAbiParameters(
                      parseAbiParameters("string,uint256,uint256"),
                      [args[0], s.mintPrice, E],
                    ),
                  },
                ]
              : [],
          logsBloom: "0x" + "00".repeat(256),
          status: "0x1",
          effectiveGasPrice: "0x3b9aca00",
          type: "0x2",
        };
        s.receipts.set(hash, receipt);
        return { result: hash };
      }
      default:
        try {
          return { result: await rpc(s, req) };
        } catch (e) {
          return {
            error: {
              code: -32000,
              message: e.message || "RPC error",
              data: e.data,
            },
          };
        }
    }
  });
  await page.addInitScript(() => {
    const listeners = new Map();
    const provider = {
      isMetaMask: true,
      request: async (req) => {
        const response = await window.__walletRequest(req);
        if (response.error) {
          const e = new Error(response.error.message);
          Object.assign(e, response.error);
          throw e;
        }
        if (response.event)
          (listeners.get(response.event[0]) || []).forEach((fn) =>
            fn(response.event[1]),
          );
        return response.result;
      },
      on: (name, fn) =>
        listeners.set(name, [...(listeners.get(name) || []), fn]),
      removeListener: (name, fn) =>
        listeners.set(
          name,
          (listeners.get(name) || []).filter((x) => x !== fn),
        ),
    };
    window.ethereum = provider;
    window.__emit = (name, value) =>
      (listeners.get(name) || []).forEach((fn) => fn(value));
  });
}
