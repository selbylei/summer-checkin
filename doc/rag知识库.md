# RAG 知识库理论速记

> Updated: 2026-09-30。本项目实践 + 主流对照，供快速回忆。

## 一、RAG 是什么

Retrieval-Augmented Generation：LLM 回答前先「翻资料」。LLM 本身没有你的私有文档，RAG 把相关文档片段检索出来塞进上下文，让它「开卷考试」。

## 二、本项目完整链路（两条）

**上传时（一次性，`src/lib/knowledge-upload.ts`）：**

| 步骤 | 干什么 | 在哪跑 |
|---|---|---|
| 1 | 解析纯文本、切 10~50 个 chunk（500~2000 字） | 本地 |
| 2 | 每个 chunk 调百炼 embedding API → 1024 维向量 | **调百炼（唯一一次）** |
| 3 | chunk 原文 + 向量 + 文档ID 写入 PostgreSQL（pgvector） | 本地 |

**提问时（每次，`src/lib/rag/`）：**

| 步骤 | 干什么 | 在哪跑 |
|---|---|---|
| 1 | 问题 → 向量 | **调百炼 ①**（`retriever.ts`） |
| 2 | 在自己库里找最接近的 top-N chunk（pgvector 距离计算） | 本地，不联网 |
| 3 | top-N + 问题发给 qwen3-rerank 精排（cross-encoder 打分，不是向量距离） | **调百炼 ②**（`rerank.ts`） |
| 4 | 排好的几段 + 问题 → LLM 生成带引用的回答 | **调 Agnes/百炼 ③** |

一句话：**本地存 + 本地比 + 云端只负责「翻译」**（文本↔向量）。百炼不留存你的数据，原文和向量全在自己的 PostgreSQL。

## 三、API Key 逻辑

同一把百炼 key 干三件事：embedding、rerank、LLM 兜底（Agnes 挂时）。
- `ALIYUN_API_KEY`：主用，所有百炼调用读它
- `EMBEDDING_API_KEY`：备用，仅 `ALIYUN_API_KEY` 未填时兜底（`.env` 规则见 `model-pool.ts` 注释）
- key 获取：bailian.console.aliyun.com → API-KEY 管理；百炼免费额度 100 万 token/模型，盘点到期 2026-11-07（代码 `freeQuotaEnd`）

## 四、和主流方案的对照

骨架一致（切块→embedding→向量库→top-k→rerank→LLM），90% 落地项目同构。差异在选型：

| 环节 | 本项目 | 其他常见 |
|---|---|---|
| 切块 | 按段落 500~2000 字 | 固定 512/1024 token、重叠切、语义切 |
| 向量模型 | text-embedding-v4（1024 维） | OpenAI text-embedding-3、BGE、本地开源 |
| 向量库 | PostgreSQL + pgvector（小中型项目主流选择，省组件） | Milvus / Pinecone / Qdrant / Weaviate（量大高性能才上） |
| 召回 | 纯向量 top-k | **混合检索（向量 + BM25 关键词）**——公认性价比最高的一招 |
| 精排 | qwen3-rerank | Cohere Rerank、bge-reranker；小项目常省 |
| 上下文 | top 几段 + 问题 | 元数据过滤、parent-document（召回小块喂整块）、GraphRAG |

## 五、演进方向（知道即可，不必做）

1. **混合检索**：检索不精准时先加 BM25 关键词路，与向量路合并去重
2. **GraphRAG**：跨文档归纳类问题更强，但要额外建图存图，成本高一量级，个人项目通常不上

## 六、项目内踩坑记录（详见 model-pool.ts 注释）

- 向量列是 `vector(1024)`，embedding 模型输出维度必须 1024：v2/v1 是 1536 维且**忽略 dimensions 参数**，禁用
- 历史三次换模型留下 116 条 1536/512 维脏数据：长度不等导致余弦恒为 0，**静默检索不到**（不报错）
- rerank 端点不能从 baseURL 推导：原生 `POST /api/v1/services/rerank/...`（2026-09-23 实测 200），`compatible-mode/v1/reranks` 是 404

## 七、与 wx-zcm 项目知识库实现对比（2026-09-30）

结论：wx-zcm（Java/mars-ai，`AiKnowledgeServiceImpl`，328 行）是「RAG-lite」——**不用向量**，靠 MySQL 全文检索 + LLM 当重排器；本项目是标准向量 RAG。

| 维度 | wx-zcm | summer-checkin |
|---|---|---|
| 检索原理 | **关键词**：MySQL ngram 全文检索 top-10（`ftsSearch`） | **语义**：pgvector 向量相似度 top-N |
| 切块 | 300 字/块、重叠 50 字 | 按段落 500~2000 字 |
| 精排 | **LLM 当重排器**：候选编号喂 prompt，LLM 回 JSON 数组 `[3,1]`，取 top-3 | 专用 cross-encoder（qwen3-rerank）数学打分 |
| 存储 | MySQL chunk 表（只存原文，无向量列） | PostgreSQL + pgvector（原文+向量同库） |
| 知识来源 | **Obsidian 仓库目录定时同步**（1h 或「立即同步」；子目录=域；删文件=停用留痕） | 用户网页上传 md/pdf/docx/txt |
| 兜底 | 三套：切块表空→内存全量注入；0 命中→同上；重排失败→取前 3 | 模型池降级链（v4→v3，403 跳下一个） |
| 注入预算 | 固定 6000 字截断 | top 几段，无显式字数预算 |

**wx-zcm 优势**：零向量基建（不花 embedding 钱、不碰维度契约坑）；知识维护走 Obsidian + git，运营改 md 一小时后生效，面向「非技术运营维护客服知识」场景。
**wx-zcm 短板**：纯关键词召回，换说法就漏（「退款怎么弄」vs 知识写「退货流程」）；知识量几百条以上压不住。
**本项目反向**：语义召回强、文档量上限高，但基建重（向量 key、维度契约、脏数据坑）。
**可互偷**：若本项目以后要支持运营维护知识，wx-zcm 的「Obsidian 目录同步 + 域/级别双轴过滤（`domains` + `maxLevel`）」是现成好模式。
