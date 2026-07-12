/**
 * v4-pro 诊断脚本：直接调用 DeepSeek v4-pro API，查看返回格式。
 *
 * 用途：诊断 PlanningGraph 中 v4-pro 返回的 JSON 缺少 message 字段的问题。
 *
 * 运行方式：
 *   $env:DEEPSEEK_API_KEY="你的API Key"
 *   npx tsx scripts/diagnose-v4pro.ts
 *
 * 或者通过命令行参数：
 *   npx tsx scripts/diagnose-v4pro.ts "你的API Key"
 */
const API_KEY = process.env.DEEPSEEK_API_KEY || process.argv[2];
const ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-v4-pro';

if (!API_KEY) {
  console.error('错误：请提供 API Key');
  console.error('方式 1: $env:DEEPSEEK_API_KEY="sk-xxx"; npx tsx scripts/diagnose-v4pro.ts');
  console.error('方式 2: npx tsx scripts/diagnose-v4pro.ts "sk-xxx"');
  process.exit(1);
}

const SYSTEM_PROMPT = `你是用户的桌面宠物助手，擅长帮用户制定可执行的一日计划。

当前上下文：
当前时间：2026-07-11 10:00（周五），时区：Asia/Shanghai（UTC+8）
用户昵称：测试用户
当前没有草案

你可以选择以下动作之一（输出严格 JSON，不要包裹在 markdown 代码块中）：

1. ask_clarification - 当用户目标模糊时，询问关键问题
2. create_draft - 信息充分时，创建计划草案
3. patch_tasks - 局部修改任务
4. delete_task - 删除单个任务
5. add_task - 添加新任务
6. request_confirmation - 草案完成后请求用户确认
7. publish_plan - 用户明确确认后发布计划

输出格式（严格 JSON）：
{
  "type": "动作类型",
  "clarificationQuestion": "追问问题（仅 ask_clarification 时）",
  "tasks": [{"start_time": "09:00", "end_time": "10:00", "content": "任务内容"}],
  "patches": [{"id": "任务ID", "start_time": "新时间", "end_time": "新时间", "content": "新内容"}],
  "taskId": "要删除的任务ID",
  "taskIndex": 1,
  "newTask": {"start_time": "11:00", "end_time": "12:00", "content": "新任务内容"},
  "message": "你对用户说的话"
}`;

const USER_MESSAGE = '今天帮我推进一下项目';

interface TestConfig {
  name: string;
  body: Record<string, unknown>;
}

async function callAPI(config: TestConfig): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`测试: ${config.name}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`请求体参数:`, JSON.stringify({
    model: config.body.model,
    response_format: config.body.response_format,
    thinking: (config.body as Record<string, unknown>).thinking ?? '未设置(默认enabled)',
    temperature: config.body.temperature,
    max_tokens: config.body.max_tokens,
    stream: config.body.stream
  }, null, 2));

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(config.body)
    });

    console.log(`\nHTTP 状态码: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.log(`错误响应: ${errorText.slice(0, 500)}`);
      return;
    }

    const data = await response.json();

    console.log(`\n--- API 返回结构 ---`);
    console.log(`model: ${data.model}`);
    console.log(`usage:`, JSON.stringify(data.usage, null, 2));

    const choice = data.choices?.[0];
    if (!choice) {
      console.log(`错误: 没有 choices`);
      return;
    }

    console.log(`\nfinish_reason: ${choice.finish_reason}`);
    console.log(`\n--- message 对象 ---`);
    console.log(`role: ${choice.message?.role}`);

    // 关键：查看 content 和 reasoning_content
    const content = choice.message?.content;
    const reasoningContent = (choice.message as Record<string, unknown>)?.reasoning_content;

    console.log(`\n--- content (原始) ---`);
    console.log(typeof content === 'string' ? content : JSON.stringify(content, null, 2));

    if (reasoningContent) {
      console.log(`\n--- reasoning_content (思考过程) ---`);
      console.log(typeof reasoningContent === 'string'
        ? reasoningContent.slice(0, 500) + (reasoningContent.length > 500 ? '...' : '')
        : JSON.stringify(reasoningContent, null, 2).slice(0, 500));
    }

    // 尝试 JSON 解析
    console.log(`\n--- JSON 解析 ---`);
    if (typeof content === 'string') {
      try {
        const parsed = JSON.parse(content);
        console.log(`解析成功!`);
        console.log(`解析后的对象:`, JSON.stringify(parsed, null, 2));
        console.log(`\n关键字段检查:`);
        console.log(`  type: ${parsed.type ?? '(缺失)'}`);
        console.log(`  message: ${parsed.message ?? '(缺失)'}`);
        console.log(`  message 类型: ${typeof parsed.message}`);
      } catch (e) {
        console.log(`JSON.parse 失败: ${(e as Error).message}`);
        // 尝试清理 markdown 代码块
        let cleaned = content.trim();
        if (cleaned.startsWith('```')) {
          cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
          try {
            const parsed = JSON.parse(cleaned);
            console.log(`清理 markdown 后解析成功!`);
            console.log(`解析后的对象:`, JSON.stringify(parsed, null, 2));
          } catch (e2) {
            console.log(`清理后仍然失败: ${(e2 as Error).message}`);
          }
        }
      }
    }
  } catch (error) {
    console.log(`请求失败: ${(error as Error).message}`);
  }
}

async function main(): Promise<void> {
  console.log('DeepSeek v4-pro 诊断脚本');
  console.log(`API Key: ${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Endpoint: ${ENDPOINT}`);

  const baseBody = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: USER_MESSAGE }
    ],
    temperature: 0.7,
    max_tokens: 2000,
    stream: false,
    response_format: { type: 'json_object' }
  };

  // 测试 1：默认设置（思考模式默认 enabled）
  await callAPI({
    name: '默认设置（思考模式 enabled，response_format=json_object）',
    body: baseBody
  });

  // 测试 2：禁用思考模式
  await callAPI({
    name: '禁用思考模式（thinking=disabled，response_format=json_object）',
    body: {
      ...baseBody,
      thinking: { type: 'disabled' }
    }
  });

  // 测试 3：禁用思考模式，不设置 response_format
  await callAPI({
    name: '禁用思考模式（thinking=disabled，无 response_format）',
    body: {
      ...baseBody,
      thinking: { type: 'disabled' },
      response_format: undefined
    }
  });

  // 测试 4：启用思考模式，不设置 response_format
  await callAPI({
    name: '默认思考模式（无 response_format）',
    body: {
      ...baseBody,
      response_format: undefined
    }
  });

  console.log('\n诊断完成。');
}

main().catch(err => {
  console.error('脚本异常:', err);
  process.exit(1);
});
