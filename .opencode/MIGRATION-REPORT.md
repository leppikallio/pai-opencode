# PAI → OpenCode Migration Report

**Generated:** 2026-01-19T00:14:50.842Z
**Source:** `vendor/PAI/Releases/v2.3/.claude`
**Target:** `.opencode`
**Mode:** EXECUTED

## Summary

| Category | Count |
|----------|-------|
| Files Converted | 767 |
| Files Skipped | 0 |
| Warnings | 4 |
| Errors | 0 |
| Manual Work Required | 15 |

## What Was Converted

- ✅ `.opencode/opencode.json`
- ✅ `.opencode/skill/Telos/ReportTemplate/App/layout.tsx`
- ✅ `.opencode/skill/Telos/ReportTemplate/App/page.tsx`
- ✅ `.opencode/skill/Telos/ReportTemplate/App/globals.css`
- ✅ `.opencode/skill/Telos/ReportTemplate/next-env.d.ts`
- ✅ `.opencode/skill/Telos/ReportTemplate/tailwind.config.ts`
- ✅ `.opencode/skill/Telos/ReportTemplate/Components/quote-block.tsx`
- ✅ `.opencode/skill/Telos/ReportTemplate/Components/severity-badge.tsx`
- ✅ `.opencode/skill/Telos/ReportTemplate/Components/recommendation-card.tsx`
- ✅ `.opencode/skill/Telos/ReportTemplate/Components/section.tsx`
- ✅ `.opencode/skill/Telos/ReportTemplate/Components/timeline.tsx`
- ✅ `.opencode/skill/Telos/ReportTemplate/Components/finding-card.tsx`
- ✅ `.opencode/skill/Telos/ReportTemplate/Components/exhibit.tsx`
- ✅ `.opencode/skill/Telos/ReportTemplate/Components/cover-page.tsx`
- ✅ `.opencode/skill/Telos/ReportTemplate/Components/callout.tsx`
- ✅ `.opencode/skill/Telos/ReportTemplate/Public/ul-icon.png`
- ✅ `.opencode/skill/Telos/ReportTemplate/Public/Fonts/concourse_3_bold.woff2`
- ✅ `.opencode/skill/Telos/ReportTemplate/Public/Fonts/concourse_3_regular.woff2`
- ✅ `.opencode/skill/Telos/ReportTemplate/Public/Fonts/advocate_34_narr_reg.woff2`
- ✅ `.opencode/skill/Telos/ReportTemplate/Public/Fonts/valkyrie_a_bold.woff2`
- ✅ `.opencode/skill/Telos/ReportTemplate/Public/Fonts/valkyrie_a_regular.woff2`
- ✅ `.opencode/skill/Telos/ReportTemplate/Public/Fonts/concourse_4_regular.woff2`
- ✅ `.opencode/skill/Telos/ReportTemplate/Public/Fonts/advocate_54_wide_reg.woff2`
- ✅ `.opencode/skill/Telos/ReportTemplate/Public/Fonts/heliotrope_3_regular.woff2`
- ✅ `.opencode/skill/Telos/ReportTemplate/Public/Fonts/concourse_4_bold.woff2`
- ✅ `.opencode/skill/Telos/ReportTemplate/Public/Fonts/valkyrie_a_italic.woff2`
- ✅ `.opencode/skill/Telos/ReportTemplate/Public/Fonts/heliotrope_3_caps_regular.woff2`
- ✅ `.opencode/skill/Telos/ReportTemplate/package.json`
- ✅ `.opencode/skill/Telos/ReportTemplate/Lib/utils.ts`
- ✅ `.opencode/skill/Telos/ReportTemplate/Lib/report-data.ts`
- ✅ `.opencode/skill/Telos/ReportTemplate/tsconfig.json`
- ✅ `.opencode/skill/Telos/ReportTemplate/postcss.config.js`
- ✅ `.opencode/skill/Telos/Tools/UpdateTelos.ts`
- ✅ `.opencode/skill/Telos/DashboardTemplate/App/add-file/page.tsx`
- ✅ `.opencode/skill/Telos/DashboardTemplate/App/progress/page.tsx`
- ✅ `.opencode/skill/Telos/DashboardTemplate/App/ask/page.tsx`
- ✅ `.opencode/skill/Telos/DashboardTemplate/App/file/[slug]/page.tsx`
- ✅ `.opencode/skill/Telos/DashboardTemplate/App/layout.tsx`
- ✅ `.opencode/skill/Telos/DashboardTemplate/App/teams/page.tsx`
- ✅ `.opencode/skill/Telos/DashboardTemplate/App/api/chat/route.ts`
- ✅ `.opencode/skill/Telos/DashboardTemplate/App/api/file/get/route.ts`
- ✅ `.opencode/skill/Telos/DashboardTemplate/App/api/file/save/route.ts`
- ✅ `.opencode/skill/Telos/DashboardTemplate/App/api/files/count/route.ts`
- ✅ `.opencode/skill/Telos/DashboardTemplate/App/api/upload/route.ts`
- ✅ `.opencode/skill/Telos/DashboardTemplate/App/page.tsx`
- ✅ `.opencode/skill/Telos/DashboardTemplate/App/globals.css`
- ✅ `.opencode/skill/Telos/DashboardTemplate/App/vulnerabilities/page.tsx`
- ✅ `.opencode/skill/Telos/DashboardTemplate/postcss.config.mjs`
- ✅ `.opencode/skill/Telos/DashboardTemplate/next.config.mjs`
- ✅ `.opencode/skill/Telos/DashboardTemplate/bun.lock`
- ✅ `.opencode/skill/Telos/DashboardTemplate/next-env.d.ts`
- ✅ `.opencode/skill/Telos/DashboardTemplate/README.md`
- ✅ `.opencode/skill/Telos/DashboardTemplate/tailwind.config.ts`
- ✅ `.opencode/skill/Telos/DashboardTemplate/Components/Ui/card.tsx`
- ✅ `.opencode/skill/Telos/DashboardTemplate/Components/Ui/progress.tsx`
- ✅ `.opencode/skill/Telos/DashboardTemplate/Components/Ui/badge.tsx`
- ✅ `.opencode/skill/Telos/DashboardTemplate/Components/Ui/table.tsx`
- ✅ `.opencode/skill/Telos/DashboardTemplate/Components/Ui/button.tsx`
- ✅ `.opencode/skill/Telos/DashboardTemplate/Components/sidebar.tsx`
- ✅ `.opencode/skill/Telos/DashboardTemplate/.gitignore`
- ✅ `.opencode/skill/Telos/DashboardTemplate/package.json`
- ✅ `.opencode/skill/Telos/DashboardTemplate/Lib/data.ts`
- ✅ `.opencode/skill/Telos/DashboardTemplate/Lib/utils.ts`
- ✅ `.opencode/skill/Telos/DashboardTemplate/Lib/telos-data.ts`
- ✅ `.opencode/skill/Telos/DashboardTemplate/tsconfig.json`
- ✅ `.opencode/skill/Telos/DashboardTemplate/.env.example`
- ✅ `.opencode/skill/Telos/Workflows/CreateNarrativePoints.md`
- ✅ `.opencode/skill/Telos/Workflows/InterviewExtraction.md`
- ✅ `.opencode/skill/Telos/Workflows/WriteReport.md`
- ✅ `.opencode/skill/Telos/Workflows/Update.md`
- ✅ `.opencode/skill/Telos/SKILL.md`
- ✅ `.opencode/skill/Research/Workflows/Retrieve.md`
- ✅ `.opencode/skill/Research/Workflows/ClaudeResearch.md`
- ✅ `.opencode/skill/Research/Workflows/QuickResearch.md`
- ✅ `.opencode/skill/Research/Workflows/StandardResearch.md`
- ✅ `.opencode/skill/Research/Workflows/ExtractKnowledge.md`
- ✅ `.opencode/skill/Research/Workflows/InterviewResearch.md`
- ✅ `.opencode/skill/Research/Workflows/WebScraping.md`
- ✅ `.opencode/skill/Research/Workflows/Fabric.md`
- ✅ `.opencode/skill/Research/Workflows/AnalyzeAiTrends.md`
- ✅ `.opencode/skill/Research/Workflows/YoutubeExtraction.md`
- ✅ `.opencode/skill/Research/Workflows/ExtractAlpha.md`
- ✅ `.opencode/skill/Research/Workflows/ExtensiveResearch.md`
- ✅ `.opencode/skill/Research/Workflows/Enhance.md`
- ✅ `.opencode/skill/Research/QuickReference.md`
- ✅ `.opencode/skill/Research/SKILL.md`
- ✅ `.opencode/skill/Research/UrlVerificationProtocol.md`
- ✅ `.opencode/skill/CORE/Tools/BannerTokyo.ts`
- ✅ `.opencode/skill/CORE/Tools/Transcribe-package.json`
- ✅ `.opencode/skill/CORE/Tools/BannerRetro.ts`
- ✅ `.opencode/skill/CORE/Tools/Banner.ts`
- ✅ `.opencode/skill/CORE/Tools/Banner.ts.backup-current`
- ✅ `.opencode/skill/CORE/Tools/BannerPrototypes.ts`
- ✅ `.opencode/skill/CORE/Tools/Inference.ts`
- ✅ `.opencode/skill/CORE/Tools/BannerNeofetch.ts`
- ✅ `.opencode/skill/CORE/Tools/ExtractTranscript.ts`
- ✅ `.opencode/skill/CORE/Tools/PAILogo.ts`
- ✅ `.opencode/skill/CORE/Tools/FeatureRegistry.ts`
- ✅ `.opencode/skill/CORE/Tools/GenerateSkillIndex.ts`
- ✅ `.opencode/skill/CORE/Tools/LearningPatternSynthesis.ts`
- ✅ `.opencode/skill/CORE/Tools/SplitAndTranscribe.ts`
- ✅ `.opencode/skill/CORE/Tools/YouTubeApi.ts`
- ✅ `.opencode/skill/CORE/Tools/GetTranscript.ts`
- ✅ `.opencode/skill/CORE/Tools/extract-transcript.py`
- ✅ `.opencode/skill/CORE/Tools/TranscriptParser.ts`
- ✅ `.opencode/skill/CORE/Tools/SkillSearch.ts`
- ✅ `.opencode/skill/CORE/Tools/AddBg.ts`
- ✅ `.opencode/skill/CORE/Tools/SessionProgress.ts`
- ✅ `.opencode/skill/CORE/Tools/SecretScan.ts`
- ✅ `.opencode/skill/CORE/Tools/RemoveBg.ts`
- ✅ `.opencode/skill/CORE/Tools/LoadSkillConfig.ts`
- ✅ `.opencode/skill/CORE/Tools/pai.ts`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/answer_interview_question/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_primary_problem/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize_debate/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_main_activities/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_investigation_visualization/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/official_pattern_template/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_extraordinary_claims/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/check_agreement/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/check_agreement/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/identify_job_stories/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_malware/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/arbiter-create-ideal/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/identify_dsrp_distinctions/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/t_threat_model_plans/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_sigma_rules/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/suggest_pattern/user_updated.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/suggest_pattern/user_clean.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/suggest_pattern/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/suggest_pattern/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_network_threat_landscape/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_network_threat_landscape/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/label_and_rate/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/tweet/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/judge_output/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/recommend_artists/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/explain_terms/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_loe_document/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_comments/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/t_create_opening_sentences/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/t_create_h3_career/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_recursive_outline/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_story_about_person/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/rate_ai_response/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_military_strategy/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_ideas/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/get_wow_per_minute/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_threat_report/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_threat_report/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_skills/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_npc/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_npc/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_quiz/README.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_quiz/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_jokes/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/t_year_in_review/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_domains/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_prose/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_prose/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_logs/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/enrich_blog_post/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_alpha/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_algorithm_update_recommendations/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_algorithm_update_recommendations/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_aphorisms/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_aphorisms/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/loaded`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_markmap_visualization/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/raw_query/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/heal_person/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/export_data_as_csv/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize_paper/README.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize_paper/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize_paper/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize_git_diff/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_presentation/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_prose_json/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_prose_json/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_proposition/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_proposition/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_design_document/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/fix_typos/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_characters/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_questions/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_wisdom_nometa/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_controversial_ideas/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize_micro/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize_micro/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/capture_thinkers_work/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_candidates/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_candidates/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/translate/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_better_frame/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_better_frame/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_conceptmap/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/t_give_encouragement/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_prd/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_interviewer_techniques/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_sponsors/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/write_essay_pg/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_micro_summary/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_article_wisdom/README.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_article_wisdom/dmiessler/extract_wisdom-1.0.0/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_article_wisdom/dmiessler/extract_wisdom-1.0.0/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_article_wisdom/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_article_wisdom/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/pattern_explanations.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/identify_dsrp_systems/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_security_update/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_security_update/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/write_micro_essay/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_academic_paper/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_wisdom/README.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_wisdom/dmiessler/extract_wisdom-1.0.0/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_wisdom/dmiessler/extract_wisdom-1.0.0/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_wisdom/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_wisdom_agents/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_claims/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_claims/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/write_nuclei_template_rule/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/write_nuclei_template_rule/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_answers/README.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_answers/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_stride_threat_model/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_risk/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize_lecture/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/review_code/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_hormozi_offer/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/t_check_metrics/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_threat_model/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_excalidraw_visualization/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_ttrc_narrative/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/rate_ai_result/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_flash_cards/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/write_semgrep_rule/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/write_semgrep_rule/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/t_analyze_challenge_handling/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/compare_and_contrast/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/compare_and_contrast/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_book_recommendations/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize/dmiessler/summarize/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize/dmiessler/summarize/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_latest_video/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_mermaid_visualization/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_email_headers/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_email_headers/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_videoid/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_videoid/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/write_pull-request/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/improve_academic_writing/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/improve_academic_writing/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/write_essay/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/t_find_neglected_goals/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/ask_secure_by_design_questions/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/t_extract_panel_topics/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_keynote/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_mistakes/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_most_redeeming_thing/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_primary_solution/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_bill_short/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_podcast_image/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_podcast_image/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/md_callout/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/generate_code_rules/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_story_about_people_interaction/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/model_as_sherlock_freud/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_user_story/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/rate_content/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/rate_content/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_threat_report_cmds/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/t_visualize_mission_goals_projects/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_video_chapters/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_video_chapters/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/get_youtube_rss/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/to_flashcards/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/find_logical_fallacies/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize_rpg_session/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_mcp_servers/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_ai_jobs_analysis/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_business_ideas/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize_board_meeting/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_graph_from_input/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_recipe/README.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_recipe/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/solve_with_cot/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/threshold/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/explain_project/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_show_intro/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_report_finding/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_report_finding/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_bill/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_book_ideas/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_cfp_submission/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize_legislation/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_rpg_summary/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_visualization/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/ai/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_references/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_references/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/identify_dsrp_perspectives/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/raycast/extract_primary_problem`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/raycast/create_story_explanation`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/raycast/capture_thinkers_work`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/raycast/extract_wisdom`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/raycast/yt`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/recommend_yoga_practice/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_5_sentence_summary/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize_pull-requests/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize_pull-requests/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_cyber_summary/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_poc/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_poc/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/refine_design_document/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_mnemonic_phrases/readme.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_mnemonic_phrases/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/arbiter-evaluate-quality/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_song_meaning/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/humanize/README.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/humanize/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/improve_writing/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/improve_writing/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/arbiter-general-evaluator/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_tech_impact/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_tech_impact/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_ctf_writeup/README.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_ctf_writeup/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/t_check_dunning_kruger/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_formal_email/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/coding_master/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_core_message/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/dialog_with_socrates/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/t_find_negative_thinking/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_coding_feature/README.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_coding_feature/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/prepare_7s_strategy/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/arbiter-run-prompt/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/find_hidden_message/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize_git_changes/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_recommendations/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_recommendations/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_idea_compass/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/rate_value/README.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/rate_value/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/rate_value/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/identify_dsrp_relationships/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_paper/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_paper/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/t_red_team_thinking/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_threat_scenarios/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_diy/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_ttrc_graph/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_insights/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_debate/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/transcribe_minutes/README.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/transcribe_minutes/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_prediction_block/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_pattern/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/write_latex/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize_meeting/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/explain_code/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/explain_code/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_personality/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_product_features/README.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_product_features/dmiessler/extract_wisdom-1.0.0/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_product_features/dmiessler/extract_wisdom-1.0.0/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_product_features/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/show_fabric_options_markmap/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_sales_call/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_patent/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_predictions/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_threat_report_trends/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_threat_report_trends/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_instructions/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_product_feedback/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/provide_guidance/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/explain_math/README.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/explain_math/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_command/README.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_command/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_command/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_terraform_plan/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/review_design/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/clean_text/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/clean_text/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/improve_prompt/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_art_prompt/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_incident/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_incident/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/t_find_blindspots/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_git_diff_commit/README.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_git_diff_commit/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/explain_docs/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/explain_docs/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/ask_uncle_duke/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/summarize_prompt/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_logo/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_logo/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_prose_pinker/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/predict_person_actions/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/write_hackerone_report/README.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/write_hackerone_report/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/recommend_pipeline_upgrades/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_reading_plan/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_summary/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_clint_summary/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_main_idea/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_mermaid_visualization_for_github/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_paper_simple/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/extract_patterns/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/youtube_summary/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/improve_report_finding/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/improve_report_finding/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/t_extract_intro_sentences/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/agility_story/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/agility_story/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/convert_to_markdown/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/find_female_life_partner/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_tags/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/t_describe_life_outlook/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_coding_project/README.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_coding_project/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/create_upgrade_pack/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_spiritual_text/system.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/Patterns/analyze_spiritual_text/user.md`
- ✅ `.opencode/skill/CORE/Tools/fabric/update-patterns.sh`
- ✅ `.opencode/skill/CORE/Tools/fabric/README.md`
- ✅ `.opencode/skill/CORE/Tools/SessionHarvester.ts`
- ✅ `.opencode/skill/CORE/Tools/NeofetchBanner.ts`
- ✅ `.opencode/skill/CORE/Tools/BannerMatrix.ts`
- ✅ `.opencode/skill/CORE/Tools/ActivityParser.ts`
- ✅ `.opencode/skill/CORE/Tools/Transcribe-bun.lock`
- ✅ `.opencode/skill/CORE/Workflows/HomeBridgeManagement.md`
- ✅ `.opencode/skill/CORE/Workflows/GitPush.md`
- ✅ `.opencode/skill/CORE/Workflows/ImageProcessing.md`
- ✅ `.opencode/skill/CORE/Workflows/Delegation.md`
- ✅ `.opencode/skill/CORE/Workflows/SessionCommit.md`
- ✅ `.opencode/skill/CORE/Workflows/SessionContinuity.md`
- ✅ `.opencode/skill/CORE/Workflows/Transcription.md`
- ✅ `.opencode/skill/CORE/Workflows/TreeOfThought.md`
- ✅ `.opencode/skill/CORE/Workflows/BackgroundDelegation.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/LEARNED.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/MISSION.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/IDEAS.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/FRAMES.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/PROBLEMS.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/CHALLENGES.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/BELIEFS.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/STATUS.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/WISDOM.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/PROJECTS.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/README.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/NARRATIVES.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/STRATEGIES.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/MODELS.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/PREDICTIONS.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/TELOS.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/MOVIES.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/TRAUMAS.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/WRONG.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/BOOKS.md`
- ✅ `.opencode/skill/CORE/USER/TELOS/GOALS.md`
- ✅ `.opencode/skill/CORE/USER/ARCHITECTURE.md`
- ✅ `.opencode/skill/CORE/USER/ALGOPREFS.md`
- ✅ `.opencode/skill/CORE/USER/HEALTH/README.md`
- ✅ `.opencode/skill/CORE/USER/DAIDENTITY.md`
- ✅ `.opencode/skill/CORE/USER/BUSINESS/README.md`
- ✅ `.opencode/skill/CORE/USER/STATUSLINE/README.md`
- ✅ `.opencode/skill/CORE/USER/TERMINAL/kitty.conf`
- ✅ `.opencode/skill/CORE/USER/TERMINAL/README.md`
- ✅ `.opencode/skill/CORE/USER/TERMINAL/ZSHRC`
- ✅ `.opencode/skill/CORE/USER/TERMINAL/shortcuts.md`
- ✅ `.opencode/skill/CORE/USER/TERMINAL/ul-circuit-embossed-v5.png`
- ✅ `.opencode/skill/CORE/USER/RESUME.md`
- ✅ `.opencode/skill/CORE/USER/README.md`
- ✅ `.opencode/skill/CORE/USER/DEFINITIONS.md`
- ✅ `.opencode/skill/CORE/USER/CONTACTS.md`
- ✅ `.opencode/skill/CORE/USER/WORK/README.md`
- ✅ `.opencode/skill/CORE/USER/CORECONTENT.md`
- ✅ `.opencode/skill/CORE/USER/PRODUCTIVITY.md`
- ✅ `.opencode/skill/CORE/USER/ABOUTME.md`
- ✅ `.opencode/skill/CORE/USER/ASSETMANAGEMENT.md`
- ✅ `.opencode/skill/CORE/USER/SKILLCUSTOMIZATIONS/Art/CharacterSpecs.md`
- ✅ `.opencode/skill/CORE/USER/SKILLCUSTOMIZATIONS/Art/PREFERENCES.md`
- ✅ `.opencode/skill/CORE/USER/SKILLCUSTOMIZATIONS/Art/SceneConstruction.md`
- ✅ `.opencode/skill/CORE/USER/SKILLCUSTOMIZATIONS/README.md`
- ✅ `.opencode/skill/CORE/USER/PAISECURITYSYSTEM/README.md`
- ✅ `.opencode/skill/CORE/USER/FINANCES/README.md`
- ✅ `.opencode/skill/CORE/USER/REMINDERS.md`
- ✅ `.opencode/skill/CORE/USER/RESPONSEFORMAT.md`
- ✅ `.opencode/skill/CORE/USER/BASICINFO.md`
- ✅ `.opencode/skill/CORE/USER/TECHSTACKPREFERENCES.md`
- ✅ `.opencode/skill/CORE/SYSTEM/DOCUMENTATIONINDEX.md`
- ✅ `.opencode/skill/CORE/SYSTEM/PIPELINES.md`
- ✅ `.opencode/skill/CORE/SYSTEM/PAIAGENTSYSTEM.md`
- ✅ `.opencode/skill/CORE/SYSTEM/PAISYSTEMARCHITECTURE.md`
- ✅ `.opencode/skill/CORE/SYSTEM/SKILLSYSTEM.md`
- ✅ `.opencode/skill/CORE/SYSTEM/THEDELEGATIONSYSTEM.md`
- ✅ `.opencode/skill/CORE/SYSTEM/THENOTIFICATIONSYSTEM.md`
- ✅ `.opencode/skill/CORE/SYSTEM/UPDATES/2026-01-08_multi-channel-notification-system.md`
- ✅ `.opencode/skill/CORE/SYSTEM/THEHOOKSYSTEM.md`
- ✅ `.opencode/skill/CORE/SYSTEM/BROWSERAUTOMATION.md`
- ✅ `.opencode/skill/CORE/SYSTEM/BACKUPS.md`
- ✅ `.opencode/skill/CORE/SYSTEM/SCRAPINGREFERENCE.md`
- ✅ `.opencode/skill/CORE/SYSTEM/TERMINALTABS.md`
- ✅ `.opencode/skill/CORE/SYSTEM/MEMORYSYSTEM.md`
- ✅ `.opencode/skill/CORE/SYSTEM/CLIFIRSTARCHITECTURE.md`
- ✅ `.opencode/skill/CORE/SYSTEM/SYSTEM_USER_EXTENDABILITY.md`
- ✅ `.opencode/skill/CORE/SYSTEM/RESPONSEFORMAT.md`
- ✅ `.opencode/skill/CORE/SYSTEM/THEFABRICSYSTEM.md`
- ✅ `.opencode/skill/CORE/SYSTEM/TOOLS.md`
- ✅ `.opencode/skill/CORE/SKILL.md`
- ✅ `.opencode/skill/CreateCLI/Workflows/UpgradeTier.md`
- ✅ `.opencode/skill/CreateCLI/Workflows/AddCommand.md`
- ✅ `.opencode/skill/CreateCLI/Workflows/CreateCli.md`
- ✅ `.opencode/skill/CreateCLI/FrameworkComparison.md`
- ✅ `.opencode/skill/CreateCLI/Patterns.md`
- ✅ `.opencode/skill/CreateCLI/SKILL.md`
- ✅ `.opencode/skill/CreateCLI/TypescriptPatterns.md`
- ✅ `.opencode/skill/PAIUpgrade/sources.json`
- ✅ `.opencode/skill/PAIUpgrade/Tools/Anthropic.ts`
- ✅ `.opencode/skill/PAIUpgrade/youtube-channels.json`
- ✅ `.opencode/skill/PAIUpgrade/Workflows/FindSources.md`
- ✅ `.opencode/skill/PAIUpgrade/Workflows/ResearchUpgrade.md`
- ✅ `.opencode/skill/PAIUpgrade/Workflows/CheckForUpgrades.md`
- ✅ `.opencode/skill/PAIUpgrade/Workflows/ReleaseNotesDeepDive.md`
- ✅ `.opencode/skill/PAIUpgrade/SKILL.md`
- ✅ `.opencode/skill/Council/OutputFormat.md`
- ✅ `.opencode/skill/Council/Workflows/Debate.md`
- ✅ `.opencode/skill/Council/Workflows/Quick.md`
- ✅ `.opencode/skill/Council/RoundStructure.md`
- ✅ `.opencode/skill/Council/SKILL.md`
- ✅ `.opencode/skill/Council/CouncilMembers.md`
- ✅ `.opencode/skill/Prompting/Tools/RenderTemplate.ts`
- ✅ `.opencode/skill/Prompting/Tools/index.ts`
- ✅ `.opencode/skill/Prompting/Tools/ValidateTemplate.ts`
- ✅ `.opencode/skill/Prompting/SKILL.md`
- ✅ `.opencode/skill/Prompting/Templates/Evals/Rubric.hbs`
- ✅ `.opencode/skill/Prompting/Templates/Evals/Report.hbs`
- ✅ `.opencode/skill/Prompting/Templates/Evals/TestCase.hbs`
- ✅ `.opencode/skill/Prompting/Templates/Evals/Judge.hbs`
- ✅ `.opencode/skill/Prompting/Templates/Evals/Comparison.hbs`
- ✅ `.opencode/skill/Prompting/Templates/Tools/.cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc`
- ✅ `.opencode/skill/Prompting/Templates/Tools/bun.lock`
- ✅ `.opencode/skill/Prompting/Templates/Tools/RenderTemplate.ts`
- ✅ `.opencode/skill/Prompting/Templates/Tools/README.md`
- ✅ `.opencode/skill/Prompting/Templates/Tools/.gitignore`
- ✅ `.opencode/skill/Prompting/Templates/Tools/package.json`
- ✅ `.opencode/skill/Prompting/Templates/Tools/tsconfig.json`
- ✅ `.opencode/skill/Prompting/Templates/Tools/index.ts`
- ✅ `.opencode/skill/Prompting/Templates/Tools/ValidateTemplate.ts`
- ✅ `.opencode/skill/Prompting/Templates/Tools/CLAUDE.md`
- ✅ `.opencode/skill/Prompting/Templates/README.md`
- ✅ `.opencode/skill/Prompting/Templates/Primitives/Structure.hbs`
- ✅ `.opencode/skill/Prompting/Templates/Primitives/Roster.hbs`
- ✅ `.opencode/skill/Prompting/Templates/Primitives/Briefing.hbs`
- ✅ `.opencode/skill/Prompting/Templates/Primitives/Voice.hbs`
- ✅ `.opencode/skill/Prompting/Templates/Primitives/Gate.hbs`
- ✅ `.opencode/skill/Prompting/Templates/Data/Agents.yaml`
- ✅ `.opencode/skill/Prompting/Templates/Data/ValidationGates.yaml`
- ✅ `.opencode/skill/Prompting/Templates/Data/VoicePresets.yaml`
- ✅ `.opencode/skill/Prompting/Standards.md`
- ✅ `.opencode/skill/RedTeam/Integration.md`
- ✅ `.opencode/skill/RedTeam/Workflows/AdversarialValidation.md`
- ✅ `.opencode/skill/RedTeam/Workflows/ParallelAnalysis.md`
- ✅ `.opencode/skill/RedTeam/SKILL.md`
- ✅ `.opencode/skill/RedTeam/Philosophy.md`
- ✅ `.opencode/skill/Art/Tools/GenerateMidjourneyImage.ts`
- ✅ `.opencode/skill/Art/Tools/GeneratePrompt.ts`
- ✅ `.opencode/skill/Art/Tools/Generate.ts`
- ✅ `.opencode/skill/Art/Tools/ComposeThumbnail.ts`
- ✅ `.opencode/skill/Art/HeadshotExamples/headshot-pondering.png`
- ✅ `.opencode/skill/Art/HeadshotExamples/headshot-what-is-that.png`
- ✅ `.opencode/skill/Art/HeadshotExamples/headshot-smiling.png`
- ✅ `.opencode/skill/Art/HeadshotExamples/headshot-outside-smiling.png`
- ✅ `.opencode/skill/Art/HeadshotExamples/headshot-hat-smiling.png`
- ✅ `.opencode/skill/Art/HeadshotExamples/headshot-yuk.png`
- ✅ `.opencode/skill/Art/HeadshotExamples/headshot-whatthehell.png`
- ✅ `.opencode/skill/Art/HeadshotExamples/Screenshot 2024-05-14 at 09.52.31.png`
- ✅ `.opencode/skill/Art/HeadshotExamples/headshot-clean.png`
- ✅ `.opencode/skill/Art/HeadshotExamples/headshot-walking-cap-smiling.png`
- ✅ `.opencode/skill/Art/HeadshotExamples/headshot-nah.png`
- ✅ `.opencode/skill/Art/HeadshotExamples/headshot-surprised-hat.png`
- ✅ `.opencode/skill/Art/ThumbnailExamples/AudioEssay.png`
- ✅ `.opencode/skill/Art/ThumbnailExamples/InterviewVideo.png`
- ✅ `.opencode/skill/Art/ThumbnailExamples/RegularVideo4.png`
- ✅ `.opencode/skill/Art/ThumbnailExamples/RegularVideo5.png`
- ✅ `.opencode/skill/Art/ThumbnailExamples/RegularVideo2.png`
- ✅ `.opencode/skill/Art/ThumbnailExamples/RegularVideo3.png`
- ✅ `.opencode/skill/Art/ThumbnailExamples/RegularVideo1.png`
- ✅ `.opencode/skill/Art/YouTubeThumbnailExamples/Main2.png`
- ✅ `.opencode/skill/Art/YouTubeThumbnailExamples/Sponsored1.png`
- ✅ `.opencode/skill/Art/YouTubeThumbnailExamples/Main3.png`
- ✅ `.opencode/skill/Art/YouTubeThumbnailExamples/Main1.png`
- ✅ `.opencode/skill/Art/YouTubeThumbnailExamples/Sponsored3.png`
- ✅ `.opencode/skill/Art/YouTubeThumbnailExamples/SPECIFICATIONS.md`
- ✅ `.opencode/skill/Art/YouTubeThumbnailExamples/Sponsored2.png`
- ✅ `.opencode/skill/Art/YouTubeThumbnailExamples/Main4.png`
- ✅ `.opencode/skill/Art/YouTubeThumbnailExamples/Main5.png`
- ✅ `.opencode/skill/Art/YouTubeThumbnailExamples/Main7.png`
- ✅ `.opencode/skill/Art/YouTubeThumbnailExamples/Main6.png`
- ✅ `.opencode/skill/Art/YouTubeThumbnailExamples/Audio1.png`
- ✅ `.opencode/skill/Art/Workflows/Stats.md`
- ✅ `.opencode/skill/Art/Workflows/D3Dashboards.md`
- ✅ `.opencode/skill/Art/Workflows/Frameworks.md`
- ✅ `.opencode/skill/Art/Workflows/Taxonomies.md`
- ✅ `.opencode/skill/Art/Workflows/AdHocYouTubeThumbnail.md`
- ✅ `.opencode/skill/Art/Workflows/Aphorisms.md`
- ✅ `.opencode/skill/Art/Workflows/Timelines.md`
- ✅ `.opencode/skill/Art/Workflows/Essay.md`
- ✅ `.opencode/skill/Art/Workflows/Comics.md`
- ✅ `.opencode/skill/Art/Workflows/TechnicalDiagrams.md`
- ✅ `.opencode/skill/Art/Workflows/Comparisons.md`
- ✅ `.opencode/skill/Art/Workflows/Maps.md`
- ✅ `.opencode/skill/Art/Workflows/Visualize.md`
- ✅ `.opencode/skill/Art/Workflows/Mermaid.md`
- ✅ `.opencode/skill/Art/Workflows/CreatePAIPackIcon.md`
- ✅ `.opencode/skill/Art/Workflows/RecipeCards.md`
- ✅ `.opencode/skill/Art/Workflows/AnnotatedScreenshots.md`
- ✅ `.opencode/skill/Art/Examples/human-linear-style2.png`
- ✅ `.opencode/skill/Art/Examples/setting-line-style.png`
- ✅ `.opencode/skill/Art/Examples/setting-line-style2.png`
- ✅ `.opencode/skill/Art/Examples/human-linear-form.png`
- ✅ `.opencode/skill/Art/SKILL.md`
- ✅ `.opencode/skill/Art/Lib/discord-bot.ts`
- ✅ `.opencode/skill/Art/Lib/midjourney-client.ts`
- ✅ `.opencode/skill/BrightData/Workflows/FourTierScrape.md`
- ✅ `.opencode/skill/BrightData/SKILL.md`
- ✅ `.opencode/skill/PrivateInvestigator/Workflows/ReverseLookup.md`
- ✅ `.opencode/skill/PrivateInvestigator/Workflows/FindPerson.md`
- ✅ `.opencode/skill/PrivateInvestigator/Workflows/VerifyIdentity.md`
- ✅ `.opencode/skill/PrivateInvestigator/Workflows/SocialMediaSearch.md`
- ✅ `.opencode/skill/PrivateInvestigator/Workflows/PublicRecordsSearch.md`
- ✅ `.opencode/skill/PrivateInvestigator/SKILL.md`
- ✅ `.opencode/skill/CreateSkill/Workflows/ValidateSkill.md`
- ✅ `.opencode/skill/CreateSkill/Workflows/CreateSkill.md`
- ✅ `.opencode/skill/CreateSkill/Workflows/UpdateSkill.md`
- ✅ `.opencode/skill/CreateSkill/Workflows/CanonicalizeSkill.md`
- ✅ `.opencode/skill/CreateSkill/SKILL.md`
- ✅ `.opencode/skill/Agents/Tools/SpawnAgentWithProfile.ts`
- ✅ `.opencode/skill/Agents/Tools/LoadAgentContext.ts`
- ✅ `.opencode/skill/Agents/Tools/AgentFactory.ts`
- ✅ `.opencode/skill/Agents/Tools/bun.lock`
- ✅ `.opencode/skill/Agents/Tools/package.json`
- ✅ `.opencode/skill/Agents/ArchitectContext.md`
- ✅ `.opencode/skill/Agents/REDESIGN-SUMMARY.md`
- ✅ `.opencode/skill/Agents/AgentProfileSystem.md`
- ✅ `.opencode/skill/Agents/Scratchpad/sparkline-color-analysis.md`
- ✅ `.opencode/skill/Agents/Workflows/CreateCustomAgent.md`
- ✅ `.opencode/skill/Agents/Workflows/ListTraits.md`
- ✅ `.opencode/skill/Agents/Workflows/SpawnParallelAgents.md`
- ✅ `.opencode/skill/Agents/AgentPersonalities.md`
- ✅ `.opencode/skill/Agents/ArtistContext.md`
- ✅ `.opencode/skill/Agents/SKILL.md`
- ✅ `.opencode/skill/Agents/EngineerContext.md`
- ✅ `.opencode/skill/Agents/CodexResearcherContext.md`
- ✅ `.opencode/skill/Agents/GrokResearcherContext.md`
- ✅ `.opencode/skill/Agents/Templates/DynamicAgent.hbs`
- ✅ `.opencode/skill/Agents/GeminiResearcherContext.md`
- ✅ `.opencode/skill/Agents/Data/Traits.yaml`
- ✅ `.opencode/skill/Agents/DesignerContext.md`
- ✅ `.opencode/skill/Agents/ClaudeResearcherContext.md`
- ✅ `.opencode/skill/Agents/QATesterContext.md`
- ✅ `.opencode/skill/OSINT/EthicalFramework.md`
- ✅ `.opencode/skill/OSINT/Methodology.md`
- ✅ `.opencode/skill/OSINT/Workflows/CompanyLookup.md`
- ✅ `.opencode/skill/OSINT/Workflows/CompanyDueDiligence.md`
- ✅ `.opencode/skill/OSINT/Workflows/PeopleLookup.md`
- ✅ `.opencode/skill/OSINT/Workflows/EntityLookup.md`
- ✅ `.opencode/skill/OSINT/PeopleTools.md`
- ✅ `.opencode/skill/OSINT/SKILL.md`
- ✅ `.opencode/skill/OSINT/CompanyTools.md`
- ✅ `.opencode/skill/OSINT/EntityTools.md`
- ✅ `.opencode/skill/System/Tools/UpdateSearch.ts`
- ✅ `.opencode/skill/System/Tools/ExtractArchitectureUpdates.ts`
- ✅ `.opencode/skill/System/Tools/UpdateIndex.ts`
- ✅ `.opencode/skill/System/Tools/CreateUpdate.ts`
- ✅ `.opencode/skill/System/Workflows/WorkContextRecall.md`
- ✅ `.opencode/skill/System/Workflows/DocumentSession.md`
- ✅ `.opencode/skill/System/Workflows/IntegrityCheck.md`
- ✅ `.opencode/skill/System/Workflows/SecretScanning.md`
- ✅ `.opencode/skill/System/Workflows/PrivacyCheck.md`
- ✅ `.opencode/skill/System/Workflows/DocumentRecent.md`
- ✅ `.opencode/skill/System/SKILL.md`
- ✅ `.opencode/skill/System/Templates/Update.md`
- ✅ `.opencode/skill/Browser/Tools/https:/danielmiessler.com/blog/introducing-amazon-curate-i-wish`
- ✅ `.opencode/skill/Browser/Tools/BrowserSession.ts`
- ✅ `.opencode/skill/Browser/Tools/Browse.ts`
- ✅ `.opencode/skill/Browser/Workflows/Extract.md`
- ✅ `.opencode/skill/Browser/Workflows/Interact.md`
- ✅ `.opencode/skill/Browser/Workflows/Screenshot.md`
- ✅ `.opencode/skill/Browser/Workflows/VerifyPage.md`
- ✅ `.opencode/skill/Browser/Workflows/Update.md`
- ✅ `.opencode/skill/Browser/bun.lock`
- ✅ `.opencode/skill/Browser/README.md`
- ✅ `.opencode/skill/Browser/http:/localhost:5173/ideas#the-full-archive`
- ✅ `.opencode/skill/Browser/http:/localhost:5173/ideas`
- ✅ `.opencode/skill/Browser/package.json`
- ✅ `.opencode/skill/Browser/examples/verify-page.ts`
- ✅ `.opencode/skill/Browser/examples/screenshot.ts`
- ✅ `.opencode/skill/Browser/examples/comprehensive-test.ts`
- ✅ `.opencode/skill/Browser/SKILL.md`
- ✅ `.opencode/skill/Browser/tsconfig.json`
- ✅ `.opencode/skill/Browser/index.ts`
- ✅ `.opencode/skill/FirstPrinciples/Workflows/Challenge.md`
- ✅ `.opencode/skill/FirstPrinciples/Workflows/Reconstruct.md`
- ✅ `.opencode/skill/FirstPrinciples/Workflows/Deconstruct.md`
- ✅ `.opencode/skill/FirstPrinciples/SKILL.md`
- ✅ `.opencode/skill/THEALGORITHM/Tools/RalphLoopExecutor.ts`
- ✅ `.opencode/skill/THEALGORITHM/Tools/EffortClassifier.ts`
- ✅ `.opencode/skill/THEALGORITHM/Tools/CapabilityLoader.ts`
- ✅ `.opencode/skill/THEALGORITHM/Tools/ISCManager.ts`
- ✅ `.opencode/skill/THEALGORITHM/Tools/TraitModifiers.ts`
- ✅ `.opencode/skill/THEALGORITHM/Tools/AlgorithmDisplay.ts`
- ✅ `.opencode/skill/THEALGORITHM/Tools/CapabilitySelector.ts`
- ✅ `.opencode/skill/THEALGORITHM/SKILL.md`
- ✅ `.opencode/skill/THEALGORITHM/Phases/Learn.md`
- ✅ `.opencode/skill/THEALGORITHM/Phases/Observe.md`
- ✅ `.opencode/skill/THEALGORITHM/Phases/Verify.md`
- ✅ `.opencode/skill/THEALGORITHM/Phases/Build.md`
- ✅ `.opencode/skill/THEALGORITHM/Phases/Plan.md`
- ✅ `.opencode/skill/THEALGORITHM/Phases/Think.md`
- ✅ `.opencode/skill/THEALGORITHM/Phases/Execute.md`
- ✅ `.opencode/skill/THEALGORITHM/Data/Capabilities.yaml`
- ✅ `.opencode/skill/THEALGORITHM/Data/VerificationMethods.yaml`
- ✅ `.opencode/skill/THEALGORITHM/Reference/ISCFormat.md`
- ✅ `.opencode/skill/THEALGORITHM/Reference/EffortMatrix.md`
- ✅ `.opencode/skill/THEALGORITHM/Reference/CapabilityMatrix.md`
- ✅ `.opencode/skill/Recon/Tools/WhoisParser.ts`
- ✅ `.opencode/skill/Recon/Tools/IpinfoClient.ts`
- ✅ `.opencode/skill/Recon/Tools/DnsUtils.ts`
- ✅ `.opencode/skill/Recon/Tools/SubdomainEnum.ts`
- ✅ `.opencode/skill/Recon/Tools/PortScan.ts`
- ✅ `.opencode/skill/Recon/Tools/CidrUtils.ts`
- ✅ `.opencode/skill/Recon/Tools/MassScan.ts`
- ✅ `.opencode/skill/Recon/Tools/PathDiscovery.ts`
- ✅ `.opencode/skill/Recon/Tools/CorporateStructure.ts`
- ✅ `.opencode/skill/Recon/Tools/EndpointDiscovery.ts`
- ✅ `.opencode/skill/Recon/Tools/BountyPrograms.ts`
- ✅ `.opencode/skill/Recon/Workflows/NetblockRecon.md`
- ✅ `.opencode/skill/Recon/Workflows/IpRecon.md`
- ✅ `.opencode/skill/Recon/Workflows/AnalyzeScanResultsGemini3.md`
- ✅ `.opencode/skill/Recon/Workflows/BountyPrograms.md`
- ✅ `.opencode/skill/Recon/Workflows/DomainRecon.md`
- ✅ `.opencode/skill/Recon/Workflows/UpdateTools.md`
- ✅ `.opencode/skill/Recon/Workflows/PassiveRecon.md`
- ✅ `.opencode/skill/Recon/README.md`
- ✅ `.opencode/skill/Recon/SKILL.md`
- ✅ `.opencode/skill/Recon/Data/BountyPrograms.json`
- ✅ `.opencode/skill/AnnualReports/Tools/UpdateSources.ts`
- ✅ `.opencode/skill/AnnualReports/Tools/ListSources.ts`
- ✅ `.opencode/skill/AnnualReports/Tools/FetchReport.ts`
- ✅ `.opencode/skill/AnnualReports/SKILL.md`
- ✅ `.opencode/agent/Artist.md`
- ✅ `.opencode/agent/QATester.md`
- ✅ `.opencode/agent/Architect.md`
- ✅ `.opencode/agent/Designer.md`
- ✅ `.opencode/agent/GeminiResearcher.md`
- ✅ `.opencode/agent/GrokResearcher.md`
- ✅ `.opencode/agent/CodexResearcher.md`
- ✅ `.opencode/agent/Pentester.md`
- ✅ `.opencode/agent/Intern.md`
- ✅ `.opencode/agent/Engineer.md`
- ✅ `.opencode/agent/ClaudeResearcher.md`
- ✅ `.opencode/MEMORY/README.md`

## Warnings

- ⚠️ PAI permissions (allow/deny/ask) cannot be auto-translated. OpenCode uses plugin-based permission handling. See MIGRATION-REPORT.md.
- ⚠️ PAI hooks (7 event types) require manual migration to OpenCode plugins. See MIGRATION-REPORT.md for details.
- ⚠️ PAI daidentity (AI name, color, voice) is not supported in OpenCode config. This can be implemented via CORE skill customization.
- ⚠️ Found 15 hooks that require manual migration to plugins. See MIGRATION-REPORT.md for details.

## Errors

No errors.

## Hooks Requiring Manual Migration

The following hooks were found but **cannot be auto-translated** due to architectural differences:

| PAI Hook File | OpenCode Equivalent | Migration Notes |
|---------------|---------------------|-----------------|
| `QuestionAnswered.hook.ts` | plugin handler | Rewrite as async function in `plugin/pai-unified.ts` |
| `ExplicitRatingCapture.hook.ts` | plugin handler | Rewrite as async function in `plugin/pai-unified.ts` |
| `ImplicitSentimentCapture.hook.ts` | plugin handler | Rewrite as async function in `plugin/pai-unified.ts` |
| `SecurityValidator.hook.ts` | plugin handler | Rewrite as async function in `plugin/pai-unified.ts` |
| `FormatEnforcer.hook.ts` | plugin handler | Rewrite as async function in `plugin/pai-unified.ts` |
| `UpdateTabTitle.hook.ts` | plugin handler | Rewrite as async function in `plugin/pai-unified.ts` |
| `CheckVersion.hook.ts` | plugin handler | Rewrite as async function in `plugin/pai-unified.ts` |
| `StartupGreeting.hook.ts` | plugin handler | Rewrite as async function in `plugin/pai-unified.ts` |
| `LoadContext.hook.ts` | plugin handler | Rewrite as async function in `plugin/pai-unified.ts` |
| `StopOrchestrator.hook.ts` | plugin handler | Rewrite as async function in `plugin/pai-unified.ts` |
| `SessionSummary.hook.ts` | plugin handler | Rewrite as async function in `plugin/pai-unified.ts` |
| `AgentOutputCapture.hook.ts` | plugin handler | Rewrite as async function in `plugin/pai-unified.ts` |
| `AutoWorkCreation.hook.ts` | plugin handler | Rewrite as async function in `plugin/pai-unified.ts` |
| `SetQuestionTab.hook.ts` | plugin handler | Rewrite as async function in `plugin/pai-unified.ts` |
| `WorkCompletionLearning.hook.ts` | plugin handler | Rewrite as async function in `plugin/pai-unified.ts` |

### Hook → Plugin Migration Guide

PAI hooks use **shell scripts with exit codes**:
```typescript
// PAI Hook (Claude Code)
export default async function(input) {
  if (dangerous) {
    process.exit(2); // Block execution
  }
}
```

OpenCode plugins use **async functions that throw**:
```typescript
// OpenCode Plugin
"tool.execute.before": async (input, output) => {
  if (dangerous) {
    throw new Error("Blocked!"); // Block execution
  }
}
```

**Key Differences:**
1. Args location: `output.args` (NOT `input.args`)
2. Tool names: lowercase (`bash`, not `Bash`)
3. Blocking: throw Error (NOT exit code 2)
4. Logging: file-only (NOT console.log - corrupts TUI)

See `docs/PLUGIN-ARCHITECTURE.md` for complete guide.

## Next Steps

1. Review the converted files in `.opencode/`
2. Manually migrate hooks to plugins (see guide above)
3. Test the OpenCode installation:
   ```bash
   cd .opencode/..
   opencode
   ```
4. Verify skills load correctly
5. Test security blocking if applicable

## References

- [PAI-OpenCode Documentation](https://github.com/Steffen025/pai-opencode)
- [OpenCode Plugin Docs](https://opencode.ai/docs/plugins/)
- `docs/PLUGIN-ARCHITECTURE.md` - Detailed plugin guide
- `docs/EVENT-MAPPING.md` - Hook → Event mapping

---
*Generated by pai-to-opencode-converter v0.8.0*
