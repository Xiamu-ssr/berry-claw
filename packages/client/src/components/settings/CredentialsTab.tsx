import { Key } from 'lucide-react';

/**
 * CredentialsTab — tool secrets (web_search keys, etc).
 *
 * Credentials were stored/served by the console backend. Under the thin-shell
 * model these are machine-side secrets: a8s writes env-var NAMES (never values)
 * and the actual secrets live on the host's machine config, not in the browser
 * or the console. There is no a8s route to read or write them, so this tab is
 * a static explainer rather than a dead CRUD form.
 */
export default function CredentialsTab() {
  return (
    <section className="rounded-xl border border-white/[0.08] bg-[#20242a]/75 p-5">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
          <Key size={20} /> Tool Credentials
        </h2>
        <p className="mt-1 text-sm text-zinc-500">
          内置工具(web_search 等)的密钥。与供应商 apiKey 分开管理。
        </p>
      </div>
      <div className="rounded-lg border border-white/[0.08] bg-black/10 px-4 py-4 text-sm leading-relaxed text-zinc-400">
        工具密钥属于机器侧机密:a8s 只登记环境变量<strong className="text-zinc-200">名称</strong>,真正的值保存在宿主机器配置里,
        不经过浏览器或控制台。请在机器上(machine 的 env / MCP 配置)维护这些密钥;控制台不提供读写入口。
      </div>
    </section>
  );
}
