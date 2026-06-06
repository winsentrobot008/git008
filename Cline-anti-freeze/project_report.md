--- MANEKI-AI 全景审计报告 ---

1. 架构骨架:

文件夹 PATH 列表
卷序列号为 1CDE-39B8
C:.
|   .gitignore
|   .git_config
|   do_git.py
Maneki-AI/main.py
Maneki-AI/app.py
Maneki-AI/streamlit_app.py
Maneki-AI/factory_ui.py
Maneki-AI/run_task.py
Maneki-AI/risk_manager.py
|   package-lock.json
|   project_report.md
|   
+---ClawWork
|   |   .dockerignore
|   |   .env.example
|   |   .gitignore
|   |   clawwork_demo.html
|   |   Dockerfile
|   |   index.html
|   |   LICENSE
|   |   local_agent.py
|   |   Procfile
|   |   README.md
|   |   render.yaml
|   |   requirements.txt
|   |   run_test_agent.sh
|   |   setup.py
|   |   start_dashboard.sh
|   |   view_logs.sh
|   |   
|   +---.github
|   |   \---workflows
|   |           deploy.yml
|   |           hf_sync.yml
|   |           
|   +---clawmode_integration
|   |   |   agent_loop.py
|   |   |   artifact_tools.py
|   |   |   cli.py
|   |   |   config.py
|   |   |   provider_wrapper.py
|   |   |   README.md
|   |   |   task_classifier.py
|   |   |   tools.py
|   |   |   __init__.py
|   |   |   
|   |   \---skill
|   |           SKILL.md
|   |           
|   +---eval
|   |   |   generate_meta_prompts.py
|   |   |   meta_prompt_generation.log
|   |   |   README.md
|   |   |   test_single_category.py
|   |   |   
|   |   \---meta_prompts
|   |       |   Accountants_and_Auditors.json
|   |       |   Administrative_Services_Managers.json
|   |       |   Audio_and_Video_Technicians.json
|   |       |   Buyers_and_Purchasing_Agents.json
|   |       |   Child_Family_and_School_Social_Workers.json
|   |       |   Compliance_Officers.json
|   |       |   Computer_and_Information_Systems_Managers.json
|   |       |   Concierges.json
|   |       |   Counter_and_Rental_Clerks.json
|   |       |   Customer_Service_Representatives.json
|   |       |   Editors.json
|   |       |   Film_and_Video_Editors.json
|   |       |   Financial_and_Investment_Analysts.json
|   |       |   Financial_Managers.json
|   |       |   First-Line_Supervisors_of_Non-Retail_Sales_Workers.json
|   |       |   First-Line_Supervisors_of_Office_and_Administrative_Support_Workers.json
|   |       |   First-Line_Supervisors_of_Police_and_Detectives.json
|   |       |   First-Line_Supervisors_of_Production_and_Operating_Workers.json
|   |       |   First-Line_Supervisors_of_Retail_Sales_Workers.json
|   |       |   General_and_Operations_Managers.json
|   |       |   generation_summary.json
|   |       |   Industrial_Engineers.json
|   |       |   Lawyers.json
|   |       |   Mechanical_Engineers.json
|   |       |   Medical_and_Health_Services_Managers.json
|   |       |   Medical_Secretaries_and_Administrative_Assistants.json
|   |       |   News_Analysts_Reporters_and_Journalists.json
|   |       |   Nurse_Practitioners.json
|   |       |   Order_Clerks.json
|   |       |   Personal_Financial_Advisors.json
|   |       |   Pharmacists.json
|   |       |   Private_Detectives_and_Investigators.json
|   |       |   Producers_and_Directors.json
|   |       |   Project_Management_Specialists.json
|   |       |   Property_Real_Estate_and_Community_Association_Managers.json
|   |       |   Real_Estate_Brokers.json
|   |       |   Real_Estate_Sales_Agents.json
|   |       |   Recreation_Workers.json
|   |       |   Registered_Nurses.json
|   |       |   Sales_Managers.json
|   |       |   Sales_Representatives_Wholesale_and_Manufacturing_Except_Technical_and_Scientific_Products.json
|   |       |   Sales_Representatives_Wholesale_and_Manufacturing_Technical_and_Scientific_Products.json
|   |       |   Securities_Commodities_and_Financial_Services_Sales_Agents.json
|   |       |   Shipping_Receiving_and_Inventory_Clerks.json
|   |       |   Software_Developers.json
|   |       |   
|   |       \---test
|   |               Accountants_and_Auditors_test.json
|   |               
|   +---frontend
|   |   |   index.html
|   |   |   package-lock.json
|   |   |   package.json
|   |   |   postcss.config.js
|   |   |   README.md
|   |   |   tailwind.config.js
|   |   |   vite.config.js
|   |   |   
|   |   \---src
|   |       |   api.js
|   |       |   App.jsx
|   |       |   DisplayNamesContext.jsx
|   |       |   index.css
|   |       |   main.jsx
|   |       |   
|   |       +---components
|   |       |       FilePreview.jsx
|   |       |       Sidebar.jsx
|   |       |       
|   |       +---hooks
|   |       |       useWebSocket.js
|   |       |       
|   |       \---pages
|   |               AgentDetail.jsx
|   |               Artifacts.jsx
|   |               Dashboard.jsx
|   |               Leaderboard.jsx
|   |               LearningView.jsx
|   |               WorkView.jsx
|   |               
|   +---livebench
|   |   |   main.py
|   |   |   README.md
|   |   |   requirements.txt
|   |   |   
|   |   +---agent
|   |   |       economic_tracker.py
|   |   |       live_agent.py
|   |   |       message_formatter.py
|   |   |       wrapup_workflow.py
|   |   |       __init__.py
|   |   |       
|   |   +---api
|   |   |       server.py
|   |   |       __init__.py
|   |   |       
|   |   +---configs
|   |   |       atic_exhaust.json
|   |   |       default_config.json
|   |   |       example_inline_tasks.json
|   |   |       example_jsonl.json
|   |   |       example_task_assignment.json
|   |   |       example_task_filters.json
|   |   |       test_claude_sonnet_4_6_thirdparty_10dollar.json
|   |   |       test_claude_sonnot_4_6_openrouter_10dollar.json
|   |   |       test_gemini_3_1_pro_openrouter_10dollar.json
|   |   |       test_gemini_3_1_pro_thirdparty_10dollar.json
|   |   |       test_glm47.json
|   |   |       test_glm47_1.json
|   |   |       test_glm47_openrouter.json
|   |   |       test_glm47_openrouter_10dollar.json
|   |   |       test_gpt4o.json
|   |   |       test_k25_openrouter_10dollar.json
|   |   |       test_qwen3max_10dollar.json
|   |   |       test_qwen3_5_plus_10dollar.json
|   |   |       
|   |   +---data
|   |   |   |   displaying_names.json
|   |   |   |   hidden_agents.json
|   |   |   |   
|   |   |   \---tasks
|   |   |           example_tasks.jsonl
|   |   |           
|   |   +---langchain_mcp_adapters
|   |   |       client.py
|   |   |       __init__.py
|   |   |       
|   |   +---prompts
|   |   |       live_agent_prompt.py
|   |   |       __init__.py
|   |   |       
|   |   +---scheduler
|   |   |       task_scheduler.py
|   |   |       __init__.py
|   |   |       
|   |   +---tools
|   |   |   |   direct_tools.py
|   |   |   |   start_live_services.py
|   |   |   |   tool_livebench.py
|   |   |   |   __init__.py
|   |   |   |   
|   |   |   \---productivity
|   |   |           code_execution.py
|   |   |           code_execution_sandbox.py
|   |   |           file_creation.py
|   |   |           file_reading.py
|   |   |           README.md
|   |   |           search.py
|   |   |           video_creation.py
|   |   |           __init__.py
|   |   |           
|   |   +---trading
|   |   |       __init__.py
|   |   |       
|   |   +---utils
|   |   |       logger.py
|   |   |       
|   |   \---work
|   |           evaluator.py
|   |           llm_evaluator.py
|   |           task_manager.py
|   |           __init__.py
|   |           
|   +---scripts
|   |   |   analyze_economic_improvements.py
|   |   |   analyze_evaluations.ipynb
|   |   |   backfill_balance_task_info.py
|   |   |   build_e2b_template.py
|   |   |   calculate_task_values.py
|   |   |   cleanup_failed_runs.py
|   |   |   derive_task_completions.py
|   |   |   domain_earnings_analysis.py
|   |   |   estimate_task_hours.py
|   |   |   generate_static_data.py
|   |   |   README.md
|   |   |   recalculate_agent_economics.py
|   |   |   task_hour_estimation.log
|   |   |   task_value_calculation.log
|   |   |   test_e2b_template.py
|   |   |   test_economic_tracker.py
|   |   |   test_task_exhaustion.py
|   |   |   test_task_value_integration.py
|   |   |   validate_economic_system.py
|   |   |   
|   |   +---task_hour_estimates
|   |   |       summary.json
|   |   |       task_hours.jsonl
|   |   |       
|   |   \---task_value_estimates
|   |           hourly_wage.csv
|   |           occupation_to_wage_mapping.json
|   |           task_values.jsonl
|   |           value_summary.json
|   |           
|   \---static
|           index.html
|           
+---Cline-anti-freeze
|   |   .clinerules
|   |   .gitignore
|   |   .heartbeat
|   |   .instance_id
|   |   .instance_registry.json
|   |   .instance_role
|   |   .sentinel.pid
|   |   clinerules.yaml
|   |   error_log.md
|   |   governance_evolution.md
|   |   governance_linker.py
|   |   Maneki-AI.clinerules.bak
|   |   monitor.py
|   |   protocols
|   |   
|   \---__pycache__
|           governance_linker.cpython-312.pyc
|           
+---Maneki-AI
|   |   .clinerules
|   |   .env
|   |   .env.example
|   |   .gitignore
|   |   api_gateway.log
|   |   api_gateway_err.log
|   |   app.py
|   |   AUTO_DEV_OUTPUT.md
|   |   claw_router.json
|   |   commands.json
|   |   Dockerfile
|   |   factory_ui.py
|   |   github_issue.py
|   |   inject_button.ps1
|   |   main.py
|   |   maneki.html
|   |   README.md
|   |   render.yaml
|   |   requirements.txt
|   |   risk_manager.py
|   |   runtime.txt
|   |   run_task.py
|   |   start_factory.py
|   |   streamlit.log
|   |   streamlit_app.py
|   |   streamlit_err.log
|   |   
|   +---.ecc
|   +---.github
|   |   +---scripts
|   |   |       coder.py
|   |   |       planner.py
|   |   |       
|   |   \---workflows
|   |           auto-dev.yml
|   |           
|   +---agents
|   |       orchestrator.py
|   |       
|   +---agent_engine
|   |   |   .gitignore
|   |   |   agent_s.ready
|   |   |   app.py
|   |   |   app_ready.py
|   |   |   bridge.py
|   |   |   bridge_queue.json
|   |   |   bridge_results.json
|   |   |   cline_daemon.py
|   |   |   cline_worker.py
|   |   |   LICENSE
|   |   |   main.py
|   |   |   models.md
|   |   |   README.md
|   |   |   render.yaml
|   |   |   requirements.txt
|   |   |   send_task.py
|   |   |   setup.py
|   |   |   start_agent_s.ps1
|   |   |   streamlit_app.py
|   |   |   WAA_setup.md
|   |   |   
|   |   +---.github
|   |   |   \---workflows
|   |   |           lint.yml
|   |   |           
|   |   +---evaluation_sets
|   |   |       test_all.json
|   |   |       test_small_new.json
|   |   |       
|   |   +---gui_agents
|   |   |   |   utils.py
|   |   |   |   __init__.py
|   |   |   |   
|   |   |   +---s1
|   |   |   |   |   cli_app.py
|   |   |   |   |   README.md
|   |   |   |   |   WindowsAgentArena.md
|   |   |   |   |   __init__.py
|   |   |   |   |   
|   |   |   |   +---aci
|   |   |   |   |   |   ACI.py
|   |   |   |   |   |   LinuxOSACI.py
|   |   |   |   |   |   MacOSACI.py
|   |   |   |   |   |   WindowsOSACI.py
|   |   |   |   |   |   __init__.py
|   |   |   |   |   |   
|   |   |   |   |   \---windowsagentarena
|   |   |   |   |           GroundingAgent.py
|   |   |   |   |           
|   |   |   |   +---core
|   |   |   |   |       AgentS.py
|   |   |   |   |       BaseModule.py
|   |   |   |   |       Knowledge.py
|   |   |   |   |       Manager.py
|   |   |   |   |       ProceduralMemory.py
|   |   |   |   |       Worker.py
|   |   |   |   |       __init__.py
|   |   |   |   |       
|   |   |   |   +---mllm
|   |   |   |   |       MultimodalAgent.py
|   |   |   |   |       MultimodalEngine.py
|   |   |   |   |       __init__.py
|   |   |   |   |       
|   |   |   |   \---utils
|   |   |   |           common_utils.py
|   |   |   |           ocr_server.py
|   |   |   |           query_perplexica.py
|   |   |   |           __init__.py
|   |   |   |           
|   |   |   +---s2
|   |   |   |   |   cli_app.py
|   |   |   |   |   WAA_setup.md
|   |   |   |   |   __init__.py
|   |   |   |   |   
|   |   |   |   +---agents
|   |   |   |   |       agent_s.py
|   |   |   |   |       grounding.py
|   |   |   |   |       manager.py
|   |   |   |   |       worker.py
|   |   |   |   |       __init__.py
|   |   |   |   |       
|   |   |   |   +---core
|   |   |   |   |       engine.py
|   |   |   |   |       knowledge.py
|   |   |   |   |       mllm.py
|   |   |   |   |       module.py
|   |   |   |   |       __init__.py
|   |   |   |   |       
|   |   |   |   +---memory
|   |   |   |   |       procedural_memory.py
|   |   |   |   |       __init__.py
|   |   |   |   |       
|   |   |   |   \---utils
|   |   |   |           common_utils.py
|   |   |   |           query_perplexica.py
|   |   |   |           __init__.py
|   |   |   |           
|   |   |   +---s2_5
|   |   |   |   |   cli_app.py
|   |   |   |   |   __init__.py
|   |   |   |   |   
|   |   |   |   +---agents
|   |   |   |   |       agent_s.py
|   |   |   |   |       grounding.py
|   |   |   |   |       worker.py
|   |   |   |   |       __init__.py
|   |   |   |   |       
|   |   |   |   +---core
|   |   |   |   |       engine.py
|   |   |   |   |       mllm.py
|   |   |   |   |       module.py
|   |   |   |   |       __init__.py
|   |   |   |   |       
|   |   |   |   +---memory
|   |   |   |   |       procedural_memory.py
|   |   |   |   |       __init__.py
|   |   |   |   |       
|   |   |   |   \---utils
|   |   |   |           common_utils.py
|   |   |   |           __init__.py
|   |   |   |           
|   |   |   \---s3
|   |   |       |   cli_app.py
|   |   |       |   __init__.py
|   |   |       |   
|   |   |       +---agents
|   |   |       |       agent_s.py
|   |   |       |       code_agent.py
|   |   |       |       grounding.py
|   |   |       |       worker.py
|   |   |       |       __init__.py
|   |   |       |       
|   |   |       +---bbon
|   |   |       |       behavior_narrator.py
|   |   |       |       comparative_judge.py
|   |   |       |       __init__.py
|   |   |       |       
|   |   |       +---core
|   |   |       |       engine.py
|   |   |       |       mllm.py
|   |   |       |       module.py
|   |   |       |       __init__.py
|   |   |       |       
|   |   |       +---memory
|   |   |       |       procedural_memory.py
|   |   |       |       __init__.py
|   |   |       |       
|   |   |       \---utils
|   |   |               common_utils.py
|   |   |               formatters.py
|   |   |               local_env.py
|   |   |               __init__.py
|   |   |               
|   |   +---images
|   |   |   |   agent_s.png
|   |   |   |   agent_s2_architecture.png
|   |   |   |   agent_s2_osworld_result.png
|   |   |   |   agent_s2_teaser.png
|   |   |   |   agent_s_architecture.pdf
|   |   |   |   osworld_result.png
|   |   |   |   results.pdf
|   |   |   |   results.png
|   |   |   |   s3_results.png
|   |   |   |   s3_results_new.png
|   |   |   |   teaser.png
|   |   |   |   windows_result.png
|   |   |   |   
|   |   |   \---waa_setup
|   |   |           fig1.png
|   |   |           fig2.png
|   |   |           
|   |   +---integrations
|   |   |   \---openclaw
|   |   |           agent_s_task
|   |   |           agent_s_wrapper.py
|   |   |           README.md
|   |   |           SKILL.md
|   |   |           
|   |   +---osworld_setup
|   |   |   +---s1
|   |   |   |       lib_run_single.py
|   |   |   |       OSWorld.md
|   |   |   |       run.py
|   |   |   |       
|   |   |   +---s2
|   |   |   |       lib_run_single.py
|   |   |   |       OSWorld.md
|   |   |   |       run.py
|   |   |   |       
|   |   |   +---s2_5
|   |   |   |       lib_run_single.py
|   |   |   |       lib_run_single_local.py
|   |   |   |       OSWorld.md
|   |   |   |       run.py
|   |   |   |       run_local.py
|   |   |   |       
|   |   |   \---s3
|   |   |       |   lib_run_single.py
|   |   |       |   OSWorld.md
|   |   |       |   run.py
|   |   |       |   run.sh
|   |   |       |   run_local.py
|   |   |       |   
|   |   |       \---bbon
|   |   |               generate_facts.py
|   |   |               run_judge.py
|   |   |               utils.py
|   |   |               
|   |   +---prompts
|   |   |       system_prompt.txt
|   |   |       
|   |   +---safety
|   |   |       forbidden_patterns.txt
|   |   |       
|   |   +---state
|   |   |       ama_state.json
|   |   |       
|   |   +---tasks
|   |   |       templates.json
|   |   |       
|   |   +---tests
|   |   |       test_providers.py
|   |   |       
|   |   \---__pycache__
|   |           bridge.cpython-312.pyc
|   |           
|   +---analyst
|   |   |   base.py
|   |   |   strategist_agent.py
|   |   |   __init__.py
|   |   |   
|   |   \---__pycache__
|   |           base.cpython-312.pyc
|   |           strategist_agent.cpython-312.pyc
|   |           __init__.cpython-312.pyc
|   |           
|   +---clearing_engine
|   |   |   core.py
|   |   |   dashboard.py
|   |   |   models.py
|   |   |   tracker.py
|   |   |   __init__.py
|   |   |   
|   |   +---data
|   |   |   +---growth
|   |   |   +---metrics
|   |   |   +---splits
|   |   |   \---valuations
|   |   \---__pycache__
|   |           core.cpython-312.pyc
|   |           models.cpython-312.pyc
|   |           tracker.cpython-312.pyc
|   |           __init__.cpython-312.pyc
|   |           
|   +---config
|   |       env.template
|   |       settings.yaml
|   |       
|   +---core
|   |   |   api_gateway.py
|   |   |   task_listener.py
|   |   |   
|   |   \---__pycache__
|   |           api_gateway.cpython-312.pyc
|   |           task_listener.cpython-312.pyc
|   |           
|   +---deliveries
|   |   |   delivery_FAC-0225096E.json
|   |   |   delivery_FAC-133DE252.json
|   |   |   delivery_FAC-1409F1EF.json
|   |   |   delivery_FAC-1F9709AB.json
|   |   |   delivery_FAC-34D09740.json
|   |   |   delivery_FAC-43539074.json
|   |   |   delivery_FAC-5056ECE7.json
|   |   |   delivery_FAC-61FFD612.json
|   |   |   delivery_FAC-62F6D2A5.json
|   |   |   delivery_FAC-75DE57B1.json
|   |   |   delivery_FAC-78F3A225.json
|   |   |   delivery_FAC-8884AF4B.json
|   |   |   delivery_FAC-89284F87.json
|   |   |   delivery_FAC-8BF92BF6.json
|   |   |   delivery_FAC-A541760F.json
|   |   |   delivery_FAC-AC7F3EC4.json
|   |   |   delivery_FAC-B69B8A6E.json
|   |   |   delivery_FAC-B8D87EB6.json
|   |   |   delivery_FAC-C4C58F96.json
|   |   |   delivery_FAC-CB642F48.json
|   |   |   delivery_FAC-EF52700B.json
|   |   |   delivery_FAC-F9015293.json
|   |   |   
|   |   +---final_builds
|   |   |       app.html
|   |   |       
|   |   +---logo_task_2
|   |   |       delivery_note.txt
|   |   |       logo.png
|   |   |       manifest.json
|   |   |       
|   |   \---sample_logo_task
|   |           delivery_note.txt
|   |           logo.png
|   |           manifest.json
|   |           
|   +---docs
|   |       PROJECT_OVERVIEW.md
|   |       WEB_ARCHITECTURE.md
|   |       
|   +---generated_outputs
|   |   +---FAC-43539074
|   |   |       app.html
|   |   |       manifest.json
|   |   |       
|   |   +---FAC-5056ECE7
|   |   |       app.html
|   |   |       manifest.json
|   |   |       
|   |   +---FAC-62F6D2A5
|   |   |       app.html
|   |   |       manifest.json
|   |   |       
|   |   +---FAC-75DE57B1
|   |   |       app.html
|   |   |       manifest.json
|   |   |       
|   |   +---FAC-78F3A225
|   |   |       manifest.json
|   |   |       
|   |   +---FAC-8884AF4B
|   |   |       app.html
|   |   |       manifest.json
|   |   |       
|   |   +---FAC-8BF92BF6
|   |   |       app.html
|   |   |       manifest.json
|   |   |       
|   |   +---FAC-A541760F
|   |   |       app.html
|   |   |       manifest.json
|   |   |       
|   |   \---FAC-F9015293
|   |           manifest.json
|   |           
|   +---hq
|   |   |   commander.py
|   |   |   __init__.py
|   |   |   
|   |   \---__pycache__
|   |           commander.cpython-312.pyc
|   |           __init__.cpython-312.pyc
|   |           
|   +---logs
|   |       app_stderr.log
|   |       app_stdout.log
|   |       grip_audit.jsonl
|   |       listener_stderr.log
|   |       listener_stdout.log
|   |       run_task_metrics_20260605_080329.json
|   |       run_task_settle_20260605_080238.json
|   |       run_task_settle_20260605_080317.json
|   |       task_DIAG-001.log
|   |       task_DIAG-001_report.json
|   |       task_FAC-0225096E_execution.json
|   |       task_FAC-0E0C3982.log
|   |       task_FAC-0E0C3982_report.json
|   |       task_FAC-133DE252_execution.json
|   |       task_FAC-1409F1EF_execution.json
|   |       task_FAC-1C328287.log
|   |       task_FAC-1C328287_report.json
|   |       task_FAC-1F9709AB_execution.json
|   |       task_FAC-34D09740_execution.json
|   |       task_FAC-43539074_execution.json
|   |       task_FAC-4E57DD7C.log
|   |       task_FAC-4E57DD7C_report.json
|   |       task_FAC-5056ECE7_execution.json
|   |       task_FAC-560901B2.log
|   |       task_FAC-560901B2_report.json
|   |       task_FAC-5F91FC09.log
|   |       task_FAC-5F91FC09_report.json
|   |       task_FAC-605AED59.log
|   |       task_FAC-605AED59_report.json
|   |       task_FAC-61FFD612_execution.json
|   |       task_FAC-62F6D2A5_execution.json
|   |       task_FAC-6CE86644.log
|   |       task_FAC-6CE86644_report.json
|   |       task_FAC-6EA2ABDB.log
|   |       task_FAC-6EA2ABDB_report.json
|   |       task_FAC-738D2EA6.log
|   |       task_FAC-738D2EA6_report.json
|   |       task_FAC-75DE57B1_execution.json
|   |       task_FAC-78F3A225_execution.json
|   |       task_FAC-8884AF4B_execution.json
|   |       task_FAC-89284F87_execution.json
|   |       task_FAC-8A91ECFE.log
|   |       task_FAC-8A91ECFE_report.json
|   |       task_FAC-8BF92BF6_execution.json
|   |       task_FAC-A541760F_execution.json
|   |       task_FAC-A6CBC928.log
|   |       task_FAC-A6CBC928_report.json
|   |       task_FAC-A8347F0C.log
|   |       task_FAC-A8347F0C_report.json
|   |       task_FAC-AC7F3EC4_execution.json
|   |       task_FAC-B69B8A6E_execution.json
|   |       task_FAC-B8D87EB6_execution.json
|   |       task_FAC-BF30F194.log
|   |       task_FAC-BF30F194_report.json
|   |       task_FAC-C4C58F96_execution.json
|   |       task_FAC-C84AFEFA.log
|   |       task_FAC-C84AFEFA_report.json
|   |       task_FAC-CB642F48_execution.json
|   |       task_FAC-D1DD0FBA.log
|   |       task_FAC-D1DD0FBA_report.json
|   |       task_FAC-D569DD44.log
|   |       task_FAC-D569DD44_report.json
|   |       task_FAC-EF52700B_execution.json
|   |       task_FAC-F48DE8A9.log
|   |       task_FAC-F48DE8A9_report.json
|   |       task_FAC-F4D7AF52.log
|   |       task_FAC-F4D7AF52_report.json
|   |       task_FAC-F9015293_execution.json
|   |       task_FAC-FD7F7D84.log
|   |       task_FAC-FD7F7D84_report.json
|   |       task_MOCK_001_report.json
|   |       task_PROJECT_OVERVIEW_20260602.log
|   |       task_TASK-4826.log
|   |       task_TASK-4826_report.json
|   |       task_TEST-INJECT-002.log
|   |       task_TEST-INJECT-002_report.json
|   |       task_TEST-LOCAL-001.log
|   |       task_TEST-LOCAL-001_report.json
|   |       task_test_grip_001.log
|   |       task_test_grip_001_report.json
|   |       task_WEB-TEST-001.log
|   |       task_WEB-TEST-001_report.json
|   |       
|   +---plans
|   |       plan_FAC-0225096E.json
|   |       plan_FAC-133DE252.json
|   |       plan_FAC-1409F1EF.json
|   |       plan_FAC-1F9709AB.json
|   |       plan_FAC-34D09740.json
|   |       plan_FAC-43539074.json
|   |       plan_FAC-5056ECE7.json
|   |       plan_FAC-61FFD612.json
|   |       plan_FAC-62F6D2A5.json
|   |       plan_FAC-75DE57B1.json
|   |       plan_FAC-78F3A225.json
|   |       plan_FAC-8884AF4B.json
|   |       plan_FAC-89284F87.json
|   |       plan_FAC-8BF92BF6.json
|   |       plan_FAC-A541760F.json
|   |       plan_FAC-AC7F3EC4.json
|   |       plan_FAC-B69B8A6E.json
|   |       plan_FAC-B8D87EB6.json
|   |       plan_FAC-C4C58F96.json
|   |       plan_FAC-CB642F48.json
|   |       plan_FAC-D57FC062.json
|   |       plan_FAC-EF52700B.json
|   |       plan_FAC-F9015293.json
|   |       
|   +---radar
|   |   |   synthesizer.py
|   |   |   tavily_client.py
|   |   |   __init__.py
|   |   |   
|   |   \---__pycache__
|   |           synthesizer.cpython-312.pyc
|   |           __init__.cpython-312.pyc
|   |           
|   +---reports
|   |       MANEKIAI_ARCHITECTURE_REPORT_FOR_GEMINI.md
|   |       MANEKIAI_MECHANISM_AND_ARCHITECTURE_ANALYSIS.md
|   |       opp_brief_20260524_172222.md
|   |       opp_brief_20260526_183311.md
|   |       opp_brief_20260527_204621.md
|   |       
|   +---safety
|   |   |   circuit_breaker.py
|   |   |   __init__.py
|   |   |   
|   |   \---__pycache__
|   |           circuit_breaker.cpython-312.pyc
|   |           __init__.cpython-312.pyc
|   |           
|   +---scripts
|   |       example_worker.py
|   |       start_tunnel.py
|   |       test_factory_startup.py
|   |       trigger_deploy.py
|   |       
|   +---state
|   |       ama_state.json
|   |       
|   +---task_queue
|   |   +---completed
|   |   |       task_DIAG-001.json
|   |   |       task_FAC-0E0C3982.json
|   |   |       task_FAC-1C328287.json
|   |   |       task_FAC-4E57DD7C.json
|   |   |       task_FAC-560901B2.json
|   |   |       task_FAC-5F91FC09.json
|   |   |       task_FAC-605AED59.json
|   |   |       task_FAC-6CE86644.json
|   |   |       task_FAC-6EA2ABDB.json
|   |   |       task_FAC-738D2EA6.json
|   |   |       task_FAC-8A91ECFE.json
|   |   |       task_FAC-A6CBC928.json
|   |   |       task_FAC-A8347F0C.json
|   |   |       task_FAC-BF30F194.json
|   |   |       task_FAC-C84AFEFA.json
|   |   |       task_FAC-D1DD0FBA.json
|   |   |       task_FAC-D569DD44.json
|   |   |       task_FAC-F48DE8A9.json
|   |   |       task_FAC-F4D7AF52.json
|   |   |       task_FAC-FD7F7D84.json
|   |   |       task_TASK-4826.json
|   |   |       task_TEST-INJECT-002.json
|   |   |       task_TEST-LOCAL-001.json
|   |   |       task_WEB-TEST-001.json
|   |   |       test_grip_001.json
|   |   |       
|   |   +---pending
|   |   \---processing
|   +---templates
|   |       index.html
|   |       
|   +---warroom
|   |   |   report_generator.py
|   |   |   __init__.py
|   |   |   
|   |   \---__pycache__
|   |           report_generator.cpython-312.pyc
|   |           __init__.cpython-312.pyc
|   |           
|   +---worker
|   |   |   actions.py
|   |   |   executor.py
|   |   |   grip.py
|   |   |   schemas.py
|   |   |   __init__.py
|   |   |   
|   |   \---__pycache__
|   |           actions.cpython-312.pyc
|   |           executor.cpython-312.pyc
|   |           grip.cpython-312.pyc
|   |           schemas.cpython-312.pyc
|   |           __init__.cpython-312.pyc
|   |           
|   +---workshop
|   |   |   ecc_core.py
|   |   |   factory_integration_map.json
|   |   |   openclaw_core.py
|   |   |   
|   |   \---__pycache__
|   |           ecc_core.cpython-312.pyc
|   |           openclaw_core.cpython-312.pyc
|   |           
|   \---__pycache__
|           app.cpython-312.pyc
|           github_issue.cpython-312.pyc
|           main.cpython-312.pyc
|           risk_manager.cpython-312.pyc
|           start_factory.cpython-312.pyc
|           
\---视频生产APP
    |   必看.png
    |   最新技术小班.jpg
    |   
    \---软件
            必看！不看用不了！.png
            灰豆AI光影引擎_5.0.0_x64-setup.exe
            获取token.png
            


2. 核心入口 (main.py/app.py 简述):

do_git.py
Maneki-AI/main.py
Maneki-AI/app.py
Maneki-AI/streamlit_app.py
Maneki-AI/factory_ui.py
Maneki-AI/run_task.py
Maneki-AI/risk_manager.py


3. 治理中心链接状态:

__pycache__
.clinerules
.gitignore
.heartbeat
.instance_id
.instance_registry.json
.instance_role
.sentinel.pid
clinerules.yaml
error_log.md
governance_evolution.md
governance_linker.py
Maneki-AI.clinerules.bak
monitor.py
protocols

报告生成完毕
