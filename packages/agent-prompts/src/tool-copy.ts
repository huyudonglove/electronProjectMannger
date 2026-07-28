export interface ToolPromptCopy {
  description: string
  useWhen: string
  avoidWhen: string
  sideEffects: string[]
  fields?: Record<string, string>
}

export const TOOL_PROMPT_COPY: Readonly<Record<string, ToolPromptCopy>> = Object.freeze({
  list_files: {
    description: '使用 ripgrep 和项目忽略规则列出项目相对目录下的文件。',
    useWhen: '需要快速发现项目文件、再选择具体文件检查时使用。',
    avoidWhen: '不要用它读取文件内容或判断 Git 修改；应改用 read_file 或 git_status。',
    sideEffects: [],
    fields: { path: '项目相对目录，默认项目根目录。' },
  },
  search_text: {
    description: '使用 ripgrep 在项目相对路径内搜索文本。',
    useWhen: '需要在项目文件中查找精确文本或正则表达式匹配时使用。',
    avoidWhen: '不要用于语义符号分析或文件修改。',
    sideEffects: [],
  },
  read_file: {
    description: '读取项目文本文件中有界的行范围。',
    useWhen: '定位到相关项目文本文件后使用，并且只请求必要的行范围。',
    avoidWhen: '不要用于二进制文件、项目外路径或无边界的全仓库读取。',
    sideEffects: [],
  },
  git_status: {
    description: '读取当前 Git 分支和简洁的工作区状态。',
    useWhen: '修改前后检查分支和脏工作区时使用。',
    avoidWhen: '不能作为最终 Diff 证据，也不得据此推断可以修改 Git 状态。',
    sideEffects: [],
  },
  git_diff: {
    description: '读取当前未暂存的 Git Diff，可限制到项目相对路径。',
    useWhen: '审查真实项目修改并提供最终 Diff 证据时使用。',
    avoidWhen: '不要用于 Git 写入、暂存、提交、checkout 或 reset。',
    sideEffects: [],
  },
  create_file: {
    description: '新建 UTF-8 文本文件；目标必须不存在，父目录必须位于项目内。',
    useWhen: '只有确实需要新的项目文本文件且目标尚不存在时使用。',
    avoidWhen: '不要用于覆盖文件、创建 Git 内部文件或通过符号链接写入。',
    sideEffects: ['创建一个项目文件。'],
  },
  apply_patch: {
    description: '以原子事务对一个或多个既有 UTF-8 项目文件执行精确文本替换。',
    useWhen: '检查当前文件内容和哈希后，用于范围明确的精确替换。',
    avoidWhen: '不要用于模糊补丁、Shell patch、Git 内部文件或未经审查的大范围重写。',
    sideEffects: ['修改一个或多个既有项目文件。'],
    fields: { expectedHash: '可选：本次补丁任何操作执行前的文件 SHA-256 哈希。' },
  },
  exec_command: {
    description: '不经过外层 Shell，运行已批准且由仓库定义的包验证脚本；脚本可能产生项目内副作用，完成后必须检查 Git。',
    useWhen: '代码修改后需要运行既有白名单包验证脚本时使用。',
    avoidWhen: '不要用于任意 Shell、安装依赖、网络工具、Git 写入或转发脚本参数。',
    sideEffects: ['启动一个项目进程。', '项目脚本可能修改项目内文件。'],
    fields: {
      cwd: '既有的项目相对目录，默认项目根目录。',
      timeoutMs: '正整数超时，且不得超过运行时上限。',
    },
  },
})

export function toolPromptCopy(name: keyof typeof TOOL_PROMPT_COPY) {
  const copy = TOOL_PROMPT_COPY[name]
  if (!copy) throw new Error(`未找到工具提示文案：${name}`)
  return copy
}
