# EKOS — Enterprise Knowledge Platform

> This is a sanitized public version of EKOS. The original repository contains sensitive information and cannot be made public, so its commit history was not carried over.

**Turn fragmented company knowledge into contextual, evidence-backed answers.**

EKOS is an enterprise knowledge platform designed to help teams find, understand and manage internal knowledge across documents and business information.

It combines **hybrid search, retrieval-augmented generation (RAG), document ingestion and role-based access control** into a single knowledge workflow.

> **EKOS is a working prototype exploring how enterprise knowledge systems can combine search, AI and controlled access without turning into a simple chatbot.**

---

## Why EKOS?

Company knowledge is often scattered across PDFs, spreadsheets, documents and internal systems.

Traditional keyword search can find matching words, but it often struggles with meaning and context.

LLM-based chat can understand questions, but without reliable retrieval and access controls it can produce answers that are difficult to trust.

EKOS explores a middle ground:

```text
Company Knowledge
       ↓
Document Ingestion
       ↓
Hybrid Retrieval
       ↓
Relevant Context
       ↓
AI Generation
       ↓
Answer + Evidence
```

The objective is not simply to "add AI".

The objective is to make organizational knowledge **easier to find, understand and use**.

---

## ✨ Core Capabilities

### Knowledge Assistant

Ask natural-language questions against the organization's knowledge base and receive contextual answers grounded in retrieved content.

### Hybrid Retrieval

Combines lexical and semantic retrieval:

```text
Lexical Search
      +
Vector Search
      ↓
RRF Fusion
      ↓
Ranked Results
```

This helps balance exact terminology with semantic similarity.

### Retrieval Evaluation

The retrieval pipeline is evaluated against a labelled query dataset rather than being treated as a black box.

Current evaluation results:

| Metric | Hybrid Retrieval | Lexical Only |
| ------ | ---------------: | -----------: |
| Hit@1  |            73.0% |        27.0% |
| Hit@5  |            88.9% |        52.4% |
| MRR    |            0.790 |            — |

Evaluation dataset: **63 labelled queries**.

These results are intended to provide measurable evidence of retrieval quality rather than relying only on subjective examples.

### Document Ingestion

EKOS supports ingestion and processing of common business documents, including:

* PDF
* DOCX
* XLSX

Documents are transformed into searchable knowledge that can be retrieved by the assistant.

### Knowledge Management

The platform separates knowledge management from knowledge consumption.

Users can:

* manage documents
* organize knowledge
* search content
* inspect retrieved sources
* interact with the Knowledge Assistant

### Role-Based Access Control

Access is enforced server-side using roles and scoped knowledge.

The prototype explores:

* role-based permissions
* department / organizational scoping
* controlled access to knowledge
* server-side authorization

---

# 🏗️ Architecture

At a high level:

```text
                    ┌─────────────────────┐
                    │       React UI      │
                    │   Knowledge / Ask   │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │     Express API     │
                    │ Business Logic /    │
                    │ Authorization       │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
        ┌──────────┐    ┌──────────────┐   ┌──────────┐
        │ Knowledge│    │ Hybrid Search│   │   AI     │
        │ Storage  │    │              │   │ Provider │
        └──────────┘    └──────┬───────┘   └──────────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
                    ▼                     ▼
              Lexical Search        Vector Search
                    │                     │
                    └──────────┬──────────┘
                               ▼
                         RRF Fusion
                               │
                               ▼
                      Relevant Context
                               │
                               ▼
                           LLM Answer
```

---

# 🔎 Retrieval Pipeline

EKOS does not rely exclusively on vector similarity.

The retrieval pipeline combines different signals:

### 1. Lexical retrieval

Useful when terminology matters and exact words or phrases are important.

### 2. Vector retrieval

Useful when the question and source content express the same concept using different language.

### 3. Reciprocal Rank Fusion

Results from both retrieval strategies are combined using **RRF** to produce a unified ranking.

### 4. Context selection

Relevant chunks are selected and passed to the generation layer.

### 5. AI generation

The configured LLM generates an answer using the retrieved context.

This separation makes it possible to evaluate retrieval independently from generation.

---

# 🤖 AI Architecture

EKOS is designed around a provider abstraction rather than coupling the application to a single model vendor.

Supported / explored providers include:

* OpenAI
* Anthropic
* Google Gemini
* Groq

This allows the application to switch models and providers without redesigning the core knowledge workflow.

The AI layer is deliberately treated as **one component of the system**, rather than the entire product.

---

# 🔐 Security & Access Control

Security is considered at the application architecture level.

The prototype includes server-side authorization and role-based access control.

Important security considerations are documented explicitly because the public version is a prototype rather than a production enterprise deployment.

The application does **not** claim to provide production-grade identity infrastructure.

Instead, it demonstrates the authorization model that would sit behind a real identity provider.

---

# 🧪 Testing & Quality

The project includes automated tests covering important parts of the application.

Testing includes:

* Unit tests
* API / integration tests
* Retrieval evaluation
* Accessibility testing
* Validation of business logic

Accessibility checks include automated testing with **axe-core**.

The goal is to validate not only whether the application works, but whether important system behaviour can be measured and tested.

---

# 🚀 Running the Project

Clone the repository and install dependencies:

```bash
npm install
```

Create the required environment configuration and start the development environment according to the setup documented in the repository.

The project can also be run using Docker.

---

# 🌐 Live Demo

**[Try EKOS](https://ekos-public.vercel.app/)**

The public deployment is intended as a demonstration environment.

It should be considered a **prototype**, not a production enterprise knowledge platform.

---

# ⚠️ Prototype Scope

EKOS is intentionally transparent about what is implemented and what is simulated.

### Real / implemented

* React application
* Express backend
* Knowledge management workflow
* Document ingestion
* Hybrid retrieval
* Vector search
* Lexical search
* RRF ranking
* AI provider abstraction
* Server-side authorization
* Role-based access control
* Automated testing
* Retrieval evaluation
* Docker configuration
* CI

### Simulated / simplified

The public prototype does not attempt to reproduce a complete enterprise identity and infrastructure environment.

Examples include:

* simulated identity
* simplified deployment architecture
* SQLite-based persistence
* local / prototype-oriented vector retrieval
* simplified enterprise configuration

This distinction is intentional.

**The goal is to demonstrate the architecture and engineering decisions without pretending that a portfolio prototype is a production SaaS platform.**

---

# 🏭 Production Evolution

A production deployment would replace several prototype components with infrastructure designed for scale and enterprise security.

For example:

```text
Prototype
   │
   ├── SQLite
   ├── Simulated identity
   ├── Local retrieval
   └── Single application process
   │
   ▼
Production
   │
   ├── PostgreSQL
   ├── Enterprise Identity Provider
   ├── Production vector infrastructure
   ├── Object storage
   ├── Async ingestion workers
   ├── Queue-based processing
   ├── Secrets management
   ├── Observability
   └── Horizontal scaling
```

Potential production improvements would include:

* OAuth2 / OIDC identity integration
* BFF-based authentication architecture
* PostgreSQL
* production vector storage
* object storage for documents
* asynchronous ingestion
* background processing workers
* queue-based workflows
* centralized observability
* production secrets management
* stronger audit and compliance controls

These are intentionally documented as **future production architecture**, not presented as existing capabilities.

---

# 📊 What This Project Demonstrates

EKOS was built to explore several problems at the intersection of software engineering, AI and enterprise operations:

**Product**

* Identifying a real organizational knowledge problem
* Designing separate knowledge management and consumption workflows
* Building around user needs rather than around an AI model

**AI**

* RAG
* embeddings
* hybrid retrieval
* retrieval evaluation
* model/provider abstraction

**Engineering**

* Full-stack TypeScript
* REST APIs
* database design
* authorization
* testing
* CI
* Docker

**Enterprise Architecture**

* RBAC
* organizational scoping
* security boundaries
* document ingestion
* production architecture considerations

---

# 🧠 Design Philosophy

EKOS is based on a simple principle:

> **AI should improve access to organizational knowledge, not replace the systems and controls that make that knowledge trustworthy.**

That means:

**Retrieval before generation.**

**Evidence before confidence.**

**Access control before convenience.**

**Measurement before claims.**

---

# 👤 About the Project

EKOS is part of my exploration into **AI-powered business systems and enterprise automation**.

My background is in **Operations and Customer Experience**, so the project starts from a business problem rather than from a purely technical experiment.

The goal is to combine operational understanding with software engineering and AI to build systems that solve practical organizational problems.

---

## License

See the repository license for details.
