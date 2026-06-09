import { Sparkles } from 'lucide-react';
import { EmptyState, WorkbenchPage } from './workbench';

/**
 * SkillMarketPage — global skill pool + external sources (ClawHub / GitHub).
 *
 * The market (source listing, search, global install/uninstall) was a console
 * backend feature. a8s models skills per-agent (listSkills / installSkill /
 * removeSkill bound to an agent), not as a global pool with a ClawHub proxy,
 * so under direct-connect there is no market endpoint to call. Rather than fire
 * dead /api/skills/* routes, the page degrades to an explicit notice; per-agent
 * skill equipping stays available on the Agents page detail panel.
 *
 * When a8s exposes a global skill registry this page becomes a thin client
 * over it (search → install into the pool → equip per agent).
 */
export default function SkillMarketPage() {
  return (
    <WorkbenchPage
      eyebrow="Config"
      title="Skill"
      description="全局 Skill 市场尚未在 a8s 控制台暴露;每个 agent 的 Skill 装备在智能体页管理。"
    >
      <div className="p-8">
        <EmptyState
          icon={<Sparkles size={24} />}
          title="Skill 市场暂未接入控制台"
          body="全局 Skill 池与 ClawHub 来源原由控制台后端提供,直连模式下尚无对应的 a8s 接口。等控制台提供 Skill 注册中心后,这里会接上搜索与安装;当前可在「智能体 → Skill 装备槽」查看每个 agent 已装配的 Skill。"
        />
      </div>
    </WorkbenchPage>
  );
}
