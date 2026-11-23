/**
 * The lines of "What changed" and of the Publish window. They are written in English when the change is made (and stored that way in the version history),
 * so in Chinese they are turned into Chinese here, when they are shown. A line that is not known stays as written.
 */
const RULES: [RegExp, string][] = [
  [/^AI translated (\d+) answers? \((.*)\) for (.*)\. Check the wording before publishing$/, 'AI 翻译了 $1 个答案（$2），商户 $3。发布前请检查用词'],
  [/^Added answer "(.*)" to topic "(.*)" \((.*)\)$/, '已把答案“$1”添加到主题“$2”（$3）'],
  [/^Added entry "(.*)" \((.*)\)$/, '已添加条目“$1”（$2）'], [/^Edited entry "(.*)" \((.*)\)$/, '已修改条目“$1”（$2）'], [/^Deleted entry "(.*)" \((.*)\)$/, '已删除条目“$1”（$2）'],
  [/^Deleted answer "(.*)" \((.*)\)$/, '已删除答案“$1”（$2）'], [/^Deleted topic "(.*)" \((.*)\)$/, '已删除主题“$1”（$2）'],
  [/^Deleted (\d+) entr(?:y|ies) \((.*)\)$/, '已删除 $1 个条目（$2）'],
  [/^Added filler word "(.*)"$/, '已添加填充词“$1”'], [/^Added greeting phrase "(.*)" \((.*)\)$/, '已添加问候语“$1”（$2）'], [/^Added greeting phrase "(.*)"$/, '已添加问候语“$1”'],
  [/^Added example question "(.*)" to "(.*)" \((.*)\)$/, '已为“$2”添加示例问题“$1”（$3）'],
  [/^Added keyword "(.*)" to topic "(.*)" \((.*)\)$/, '已把关键词“$1”添加到主题“$2”（$3）'],
  [/^Added mild rude word "(.*)"$/, '已添加轻微粗鲁的词“$1”'], [/^Added rude word "(.*)"$/, '已添加粗鲁的词“$1”'],
  [/^Added question word "(.*)" \((.*)\)$/, '已添加疑问词“$1”（$2）'],
  [/^Added global short form "(.*)" → (.*)$/, '已添加全局简称“$1”→ $2'], [/^Added short form "(.*)" → (.*) \((.*)\)$/, '已添加简称“$1”→ $2（$3）'],
  [/^Added to block list "(.*)" \((.*)\)$/, '已加入拦截列表“$1”（$2）'],
  [/^Added topic "(.*)" \(all merchants\)$/, '已添加主题“$1”（所有商户）'], [/^Added topic "(.*)" \((.*)\)$/, '已添加主题“$1”（$2）'], [/^Added topic word "(.*)" \((.*)\)$/, '已添加主题词“$1”（$2）'],
  [/^Changed settings for (.*)$/, '已更改 $1 的设置'],
  [/^Imported (\d+) entries from (.*) \((\d+) new, (\d+) updated\) for (.*)$/, '已从 $2 导入 $1 个条目（$3 个新增，$4 个更新），商户 $5'],
  [/^Made "(.*)" a new topic: (.*) \((.*)\)$/, '已把“$1”变成新主题：$2（$3）'], [/^Marked "(.*)" as a filler word$/, '已把“$1”标为填充词'],
  [/^Moved answer "(.*)" from (.*) to (.*)$/, '已把答案“$1”从 $2 移到 $3'], [/^Moved keyword "(.*)" from (.*) to (.*)$/, '已把关键词“$1”从 $2 移到 $3'],
  [/^Moved shared word "(.*)" from (.*) to (.*) \(all merchants\)$/, '已把共用词“$1”从 $2 移到 $3（所有商户）'],
  [/^Removed filler word "(.*)"$/, '已删除填充词“$1”'], [/^Removed from block list "(.*)" \((.*)\)$/, '已从拦截列表删除“$1”（$2）'],
  [/^Removed greeting phrase "(.*)"$/, '已删除问候语“$1”'], [/^Removed question word "(.*)" \((.*)\)$/, '已删除疑问词“$1”（$2）'],
  [/^Removed shared short form "(.*)" from (.*) \(all merchants\)$/, '已从 $2 删除共用简称“$1”（所有商户）'],
  [/^Removed short form "(.*)" → (.*)$/, '已删除简称“$1”→ $2'], [/^Removed short form "(.*)" \((.*)\)$/, '已删除简称“$1”（$2）'],
  [/^Added "(.*)" from what the bot learned \((.*)\)$/, '已添加“$1”（来自机器人学到的内容）（$2）'],
  [/^Set "(.*)" live \((.*)\)$/, '已把“$1”设为启用（$2）'], [/^Set "(.*)" draft \((.*)\)$/, '已把“$1”设为草稿（$2）'],
  [/^Set (\d+) entr(?:y|ies) live \((.*)\)$/, '已把 $1 个条目设为启用（$2）'], [/^Set (\d+) entr(?:y|ies) draft \((.*)\)$/, '已把 $1 个条目设为草稿（$2）'],
];
export const tChange = (lang: string, line: string): string => {
  if (lang !== 'zh') return line;
  for (const [re, out] of RULES) if (re.test(line)) return line.replace(re, out);
  return line;
};
