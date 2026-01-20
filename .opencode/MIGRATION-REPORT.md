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
- ✅ `.opencode/skills/Telos/ReportTemplate/App/layout.tsx`
- ✅ `.opencode/skills/Telos/ReportTemplate/App/page.tsx`
- ✅ `.opencode/skills/Telos/ReportTemplate/App/globals.css`
- ✅ `.opencode/skills/Telos/ReportTemplate/next-env.d.ts`
- ✅ `.opencode/skills/Telos/ReportTemplate/tailwind.config.ts`
- ✅ `.opencode/skills/Telos/ReportTemplate/Components/quote-block.tsx`
- ✅ `.opencode/skills/Telos/ReportTemplate/Components/severity-badge.tsx`
- ✅ `.opencode/skills/Telos/ReportTemplate/Components/recommendation-card.tsx`
- ✅ `.opencode/skills/Telos/ReportTemplate/Components/section.tsx`
- ✅ `.opencode/skills/Telos/ReportTemplate/Components/timeline.tsx`
- ✅ `.opencode/skills/Telos/ReportTemplate/Components/finding-card.tsx`
- ✅ `.opencode/skills/Telos/ReportTemplate/Components/exhibit.tsx`
- ✅ `.opencode/skills/Telos/ReportTemplate/Components/cover-page.tsx`
- ✅ `.opencode/skills/Telos/ReportTemplate/Components/callout.tsx`
- ✅ `.opencode/skills/Telos/ReportTemplate/Public/ul-icon.png`
- ✅ `.opencode/skills/Telos/ReportTemplate/Public/Fonts/concourse_3_bold.woff2`
- ✅ `.opencode/skills/Telos/ReportTemplate/Public/Fonts/concourse_3_regular.woff2`
- ✅ `.opencode/skills/Telos/ReportTemplate/Public/Fonts/advocate_34_narr_reg.woff2`
- ✅ `.opencode/skills/Telos/ReportTemplate/Public/Fonts/valkyrie_a_bold.woff2`
- ✅ `.opencode/skills/Telos/ReportTemplate/Public/Fonts/valkyrie_a_regular.woff2`
- ✅ `.opencode/skills/Telos/ReportTemplate/Public/Fonts/concourse_4_regular.woff2`
- ✅ `.opencode/skills/Telos/ReportTemplate/Public/Fonts/advocate_54_wide_reg.woff2`
- ✅ `.opencode/skills/Telos/ReportTemplate/Public/Fonts/heliotrope_3_regular.woff2`
- ✅ `.opencode/skills/Telos/ReportTemplate/Public/Fonts/concourse_4_bold.woff2`
- ✅ `.opencode/skills/Telos/ReportTemplate/Public/Fonts/valkyrie_a_italic.woff2`
- ✅ `.opencode/skills/Telos/ReportTemplate/Public/Fonts/heliotrope_3_caps_regular.woff2`
- ✅ `.opencode/skills/Telos/ReportTemplate/package.json`
- ✅ `.opencode/skills/Telos/ReportTemplate/Lib/utils.ts`
- ✅ `.opencode/skills/Telos/ReportTemplate/Lib/report-data.ts`
- ✅ `.opencode/skills/Telos/ReportTemplate/tsconfig.json`
- ✅ `.opencode/skills/Telos/ReportTemplate/postcss.config.js`
- ✅ `.opencode/skills/Telos/Tools/UpdateTelos.ts`
- ✅ `.opencode/skills/Telos/DashboardTemplate/App/add-file/page.tsx`
- ✅ `.opencode/skills/Telos/DashboardTemplate/App/progress/page.tsx`
- ✅ `.opencode/skills/Telos/DashboardTemplate/App/ask/page.tsx`
- ✅ `.opencode/skills/Telos/DashboardTemplate/App/file/[slug]/page.tsx`
- ✅ `.opencode/skills/Telos/DashboardTemplate/App/layout.tsx`
- ✅ `.opencode/skills/Telos/DashboardTemplate/App/teams/page.tsx`
- ✅ `.opencode/skills/Telos/DashboardTemplate/App/api/chat/route.ts`
- ✅ `.opencode/skills/Telos/DashboardTemplate/App/api/file/get/route.ts`
- ✅ `.opencode/skills/Telos/DashboardTemplate/App/api/file/save/route.ts`
- ✅ `.opencode/skills/Telos/DashboardTemplate/App/api/files/count/route.ts`
- ✅ `.opencode/skills/Telos/DashboardTemplate/App/api/upload/route.ts`
- ✅ `.opencode/skills/Telos/DashboardTemplate/App/page.tsx`
- ✅ `.opencode/skills/Telos/DashboardTemplate/App/globals.css`
- ✅ `.opencode/skills/Telos/DashboardTemplate/App/vulnerabilities/page.tsx`
- ✅ `.opencode/skills/Telos/DashboardTemplate/postcss.config.mjs`
- ✅ `.opencode/skills/Telos/DashboardTemplate/next.config.mjs`
- ✅ `.opencode/skills/Telos/DashboardTemplate/bun.lock`
- ✅ `.opencode/skills/Telos/DashboardTemplate/next-env.d.ts`
- ✅ `.opencode/skills/Telos/DashboardTemplate/README.md`
- ✅ `.opencode/skills/Telos/DashboardTemplate/tailwind.config.ts`
- ✅ `.opencode/skills/Telos/DashboardTemplate/Components/Ui/card.tsx`
- ✅ `.opencode/skills/Telos/DashboardTemplate/Components/Ui/progress.tsx`
- ✅ `.opencode/skills/Telos/DashboardTemplate/Components/Ui/badge.tsx`
- ✅ `.opencode/skills/Telos/DashboardTemplate/Components/Ui/table.tsx`
- ✅ `.opencode/skills/Telos/DashboardTemplate/Components/Ui/button.tsx`
- ✅ `.opencode/skills/Telos/DashboardTemplate/Components/sidebar.tsx`
- ✅ `.opencode/skills/Telos/DashboardTemplate/.gitignore`
- ✅ `.opencode/skills/Telos/DashboardTemplate/package.json`
- ✅ `.opencode/skills/Telos/DashboardTemplate/Lib/data.ts`
- ✅ `.opencode/skills/Telos/DashboardTemplate/Lib/utils.ts`
- ✅ `.opencode/skills/Telos/DashboardTemplate/Lib/telos-data.ts`
- ✅ `.opencode/skills/Telos/DashboardTemplate/tsconfig.json`
- ✅ `.opencode/skills/Telos/DashboardTemplate/.env.example`
- ✅ `.opencode/skills/Telos/Workflows/CreateNarrativePoints.md`
- ✅ `.opencode/skills/Telos/Workflows/InterviewExtraction.md`
- ✅ `.opencode/skills/Telos/Workflows/WriteReport.md`
- ✅ `.opencode/skills/Telos/Workflows/Update.md`
- ✅ `.opencode/skills/Telos/SKILL.md`
- ✅ `.opencode/skills/Research/Workflows/Retrieve.md`
- ✅ `.opencode/skills/Research/Workflows/ClaudeResearch.md`
- ✅ `.opencode/skills/Research/Workflows/QuickResearch.md`
- ✅ `.opencode/skills/Research/Workflows/StandardResearch.md`
- ✅ `.opencode/skills/Research/Workflows/ExtractKnowledge.md`
- ✅ `.opencode/skills/Research/Workflows/InterviewResearch.md`
- ✅ `.opencode/skills/Research/Workflows/WebScraping.md`
- ✅ `.opencode/skills/Research/Workflows/Fabric.md`
- ✅ `.opencode/skills/Research/Workflows/AnalyzeAiTrends.md`
- ✅ `.opencode/skills/Research/Workflows/YoutubeExtraction.md`
- ✅ `.opencode/skills/Research/Workflows/ExtractAlpha.md`
- ✅ `.opencode/skills/Research/Workflows/ExtensiveResearch.md`
- ✅ `.opencode/skills/Research/Workflows/Enhance.md`
- ✅ `.opencode/skills/Research/QuickReference.md`
- ✅ `.opencode/skills/Research/SKILL.md`
- ✅ `.opencode/skills/Research/UrlVerificationProtocol.md`
- ✅ `.opencode/skills/CORE/Tools/BannerTokyo.ts`
- ✅ `.opencode/skills/CORE/Tools/Transcribe-package.json`
- ✅ `.opencode/skills/CORE/Tools/BannerRetro.ts`
- ✅ `.opencode/skills/CORE/Tools/Banner.ts`
- ✅ `.opencode/skills/CORE/Tools/Banner.ts.backup-current`
- ✅ `.opencode/skills/CORE/Tools/BannerPrototypes.ts`
- ✅ `.opencode/skills/CORE/Tools/Inference.ts`
- ✅ `.opencode/skills/CORE/Tools/BannerNeofetch.ts`
- ✅ `.opencode/skills/CORE/Tools/ExtractTranscript.ts`
- ✅ `.opencode/skills/CORE/Tools/PAILogo.ts`
- ✅ `.opencode/skills/CORE/Tools/FeatureRegistry.ts`
- ✅ `.opencode/skills/CORE/Tools/GenerateSkillIndex.ts`
- ✅ `.opencode/skills/CORE/Tools/LearningPatternSynthesis.ts`
- ✅ `.opencode/skills/CORE/Tools/SplitAndTranscribe.ts`
- ✅ `.opencode/skills/CORE/Tools/YouTubeApi.ts`
- ✅ `.opencode/skills/CORE/Tools/GetTranscript.ts`
- ✅ `.opencode/skills/CORE/Tools/extract-transcript.py`
- ✅ `.opencode/skills/CORE/Tools/TranscriptParser.ts`
- ✅ `.opencode/skills/CORE/Tools/SkillSearch.ts`
- ✅ `.opencode/skills/CORE/Tools/AddBg.ts`
- ✅ `.opencode/skills/CORE/Tools/SessionProgress.ts`
- ✅ `.opencode/skills/CORE/Tools/SecretScan.ts`
- ✅ `.opencode/skills/CORE/Tools/RemoveBg.ts`
- ✅ `.opencode/skills/CORE/Tools/LoadSkillConfig.ts`
- ✅ `.opencode/skills/CORE/Tools/pai.ts`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/answer_interview_question/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_primary_problem/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize_debate/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_main_activities/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_investigation_visualization/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/official_pattern_template/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_extraordinary_claims/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/check_agreement/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/check_agreement/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/identify_job_stories/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_malware/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/arbiter-create-ideal/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/identify_dsrp_distinctions/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/t_threat_model_plans/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_sigma_rules/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/suggest_pattern/user_updated.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/suggest_pattern/user_clean.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/suggest_pattern/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/suggest_pattern/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_network_threat_landscape/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_network_threat_landscape/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/label_and_rate/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/tweet/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/judge_output/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/recommend_artists/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/explain_terms/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_loe_document/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_comments/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/t_create_opening_sentences/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/t_create_h3_career/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_recursive_outline/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_story_about_person/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/rate_ai_response/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_military_strategy/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_ideas/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/get_wow_per_minute/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_threat_report/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_threat_report/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_skills/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_npc/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_npc/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_quiz/README.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_quiz/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_jokes/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/t_year_in_review/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_domains/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_prose/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_prose/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_logs/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/enrich_blog_post/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_alpha/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_algorithm_update_recommendations/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_algorithm_update_recommendations/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_aphorisms/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_aphorisms/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/loaded`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_markmap_visualization/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/raw_query/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/heal_person/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/export_data_as_csv/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize_paper/README.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize_paper/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize_paper/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize_git_diff/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_presentation/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_prose_json/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_prose_json/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_proposition/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_proposition/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_design_document/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/fix_typos/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_characters/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_questions/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_wisdom_nometa/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_controversial_ideas/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize_micro/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize_micro/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/capture_thinkers_work/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_candidates/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_candidates/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/translate/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_better_frame/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_better_frame/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_conceptmap/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/t_give_encouragement/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_prd/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_interviewer_techniques/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_sponsors/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/write_essay_pg/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_micro_summary/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_article_wisdom/README.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_article_wisdom/dmiessler/extract_wisdom-1.0.0/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_article_wisdom/dmiessler/extract_wisdom-1.0.0/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_article_wisdom/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_article_wisdom/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/pattern_explanations.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/identify_dsrp_systems/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_security_update/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_security_update/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/write_micro_essay/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_academic_paper/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_wisdom/README.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_wisdom/dmiessler/extract_wisdom-1.0.0/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_wisdom/dmiessler/extract_wisdom-1.0.0/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_wisdom/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_wisdom_agents/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_claims/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_claims/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/write_nuclei_template_rule/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/write_nuclei_template_rule/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_answers/README.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_answers/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_stride_threat_model/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_risk/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize_lecture/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/review_code/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_hormozi_offer/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/t_check_metrics/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_threat_model/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_excalidraw_visualization/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_ttrc_narrative/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/rate_ai_result/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_flash_cards/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/write_semgrep_rule/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/write_semgrep_rule/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/t_analyze_challenge_handling/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/compare_and_contrast/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/compare_and_contrast/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_book_recommendations/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize/dmiessler/summarize/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize/dmiessler/summarize/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_latest_video/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_mermaid_visualization/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_email_headers/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_email_headers/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_videoid/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_videoid/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/write_pull-request/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/improve_academic_writing/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/improve_academic_writing/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/write_essay/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/t_find_neglected_goals/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/ask_secure_by_design_questions/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/t_extract_panel_topics/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_keynote/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_mistakes/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_most_redeeming_thing/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_primary_solution/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_bill_short/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_podcast_image/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_podcast_image/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/md_callout/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/generate_code_rules/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_story_about_people_interaction/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/model_as_sherlock_freud/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_user_story/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/rate_content/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/rate_content/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_threat_report_cmds/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/t_visualize_mission_goals_projects/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_video_chapters/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_video_chapters/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/get_youtube_rss/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/to_flashcards/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/find_logical_fallacies/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize_rpg_session/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_mcp_servers/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_ai_jobs_analysis/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_business_ideas/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize_board_meeting/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_graph_from_input/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_recipe/README.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_recipe/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/solve_with_cot/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/threshold/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/explain_project/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_show_intro/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_report_finding/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_report_finding/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_bill/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_book_ideas/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_cfp_submission/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize_legislation/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_rpg_summary/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_visualization/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/ai/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_references/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_references/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/identify_dsrp_perspectives/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/raycast/extract_primary_problem`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/raycast/create_story_explanation`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/raycast/capture_thinkers_work`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/raycast/extract_wisdom`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/raycast/yt`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/recommend_yoga_practice/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_5_sentence_summary/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize_pull-requests/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize_pull-requests/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_cyber_summary/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_poc/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_poc/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/refine_design_document/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_mnemonic_phrases/readme.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_mnemonic_phrases/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/arbiter-evaluate-quality/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_song_meaning/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/humanize/README.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/humanize/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/improve_writing/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/improve_writing/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/arbiter-general-evaluator/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_tech_impact/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_tech_impact/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_ctf_writeup/README.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_ctf_writeup/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/t_check_dunning_kruger/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_formal_email/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/coding_master/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_core_message/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/dialog_with_socrates/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/t_find_negative_thinking/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_coding_feature/README.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_coding_feature/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/prepare_7s_strategy/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/arbiter-run-prompt/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/find_hidden_message/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize_git_changes/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_recommendations/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_recommendations/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_idea_compass/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/rate_value/README.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/rate_value/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/rate_value/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/identify_dsrp_relationships/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_paper/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_paper/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/t_red_team_thinking/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_threat_scenarios/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_diy/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_ttrc_graph/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_insights/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_debate/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/transcribe_minutes/README.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/transcribe_minutes/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_prediction_block/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_pattern/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/write_latex/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize_meeting/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/explain_code/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/explain_code/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_personality/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_product_features/README.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_product_features/dmiessler/extract_wisdom-1.0.0/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_product_features/dmiessler/extract_wisdom-1.0.0/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_product_features/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/show_fabric_options_markmap/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_sales_call/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_patent/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_predictions/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_threat_report_trends/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_threat_report_trends/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_instructions/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_product_feedback/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/provide_guidance/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/explain_math/README.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/explain_math/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_command/README.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_command/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_command/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_terraform_plan/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/review_design/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/clean_text/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/clean_text/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/improve_prompt/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_art_prompt/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_incident/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_incident/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/t_find_blindspots/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_git_diff_commit/README.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_git_diff_commit/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/explain_docs/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/explain_docs/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/ask_uncle_duke/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/summarize_prompt/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_logo/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_logo/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_prose_pinker/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/predict_person_actions/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/write_hackerone_report/README.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/write_hackerone_report/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/recommend_pipeline_upgrades/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_reading_plan/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_summary/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_clint_summary/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_main_idea/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_mermaid_visualization_for_github/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_paper_simple/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/extract_patterns/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/youtube_summary/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/improve_report_finding/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/improve_report_finding/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/t_extract_intro_sentences/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/agility_story/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/agility_story/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/convert_to_markdown/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/find_female_life_partner/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_tags/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/t_describe_life_outlook/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_coding_project/README.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_coding_project/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/create_upgrade_pack/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_spiritual_text/system.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/Patterns/analyze_spiritual_text/user.md`
- ✅ `.opencode/skills/CORE/Tools/fabric/update-patterns.sh`
- ✅ `.opencode/skills/CORE/Tools/fabric/README.md`
- ✅ `.opencode/skills/CORE/Tools/SessionHarvester.ts`
- ✅ `.opencode/skills/CORE/Tools/NeofetchBanner.ts`
- ✅ `.opencode/skills/CORE/Tools/BannerMatrix.ts`
- ✅ `.opencode/skills/CORE/Tools/ActivityParser.ts`
- ✅ `.opencode/skills/CORE/Tools/Transcribe-bun.lock`
- ✅ `.opencode/skills/CORE/Workflows/HomeBridgeManagement.md`
- ✅ `.opencode/skills/CORE/Workflows/GitPush.md`
- ✅ `.opencode/skills/CORE/Workflows/ImageProcessing.md`
- ✅ `.opencode/skills/CORE/Workflows/Delegation.md`
- ✅ `.opencode/skills/CORE/Workflows/SessionCommit.md`
- ✅ `.opencode/skills/CORE/Workflows/SessionContinuity.md`
- ✅ `.opencode/skills/CORE/Workflows/Transcription.md`
- ✅ `.opencode/skills/CORE/Workflows/TreeOfThought.md`
- ✅ `.opencode/skills/CORE/Workflows/BackgroundDelegation.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/LEARNED.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/MISSION.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/IDEAS.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/FRAMES.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/PROBLEMS.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/CHALLENGES.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/BELIEFS.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/STATUS.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/WISDOM.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/PROJECTS.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/README.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/NARRATIVES.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/STRATEGIES.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/MODELS.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/PREDICTIONS.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/TELOS.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/MOVIES.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/TRAUMAS.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/WRONG.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/BOOKS.md`
- ✅ `.opencode/skills/CORE/USER/TELOS/GOALS.md`
- ✅ `.opencode/skills/CORE/USER/ARCHITECTURE.md`
- ✅ `.opencode/skills/CORE/USER/ALGOPREFS.md`
- ✅ `.opencode/skills/CORE/USER/HEALTH/README.md`
- ✅ `.opencode/skills/CORE/USER/DAIDENTITY.md`
- ✅ `.opencode/skills/CORE/USER/BUSINESS/README.md`
- ✅ `.opencode/skills/CORE/USER/STATUSLINE/README.md`
- ✅ `.opencode/skills/CORE/USER/TERMINAL/kitty.conf`
- ✅ `.opencode/skills/CORE/USER/TERMINAL/README.md`
- ✅ `.opencode/skills/CORE/USER/TERMINAL/ZSHRC`
- ✅ `.opencode/skills/CORE/USER/TERMINAL/shortcuts.md`
- ✅ `.opencode/skills/CORE/USER/TERMINAL/ul-circuit-embossed-v5.png`
- ✅ `.opencode/skills/CORE/USER/RESUME.md`
- ✅ `.opencode/skills/CORE/USER/README.md`
- ✅ `.opencode/skills/CORE/USER/DEFINITIONS.md`
- ✅ `.opencode/skills/CORE/USER/CONTACTS.md`
- ✅ `.opencode/skills/CORE/USER/WORK/README.md`
- ✅ `.opencode/skills/CORE/USER/CORECONTENT.md`
- ✅ `.opencode/skills/CORE/USER/PRODUCTIVITY.md`
- ✅ `.opencode/skills/CORE/USER/ABOUTME.md`
- ✅ `.opencode/skills/CORE/USER/ASSETMANAGEMENT.md`
- ✅ `.opencode/skills/CORE/USER/SKILLCUSTOMIZATIONS/Art/CharacterSpecs.md`
- ✅ `.opencode/skills/CORE/USER/SKILLCUSTOMIZATIONS/Art/PREFERENCES.md`
- ✅ `.opencode/skills/CORE/USER/SKILLCUSTOMIZATIONS/Art/SceneConstruction.md`
- ✅ `.opencode/skills/CORE/USER/SKILLCUSTOMIZATIONS/README.md`
- ✅ `.opencode/skills/CORE/USER/PAISECURITYSYSTEM/README.md`
- ✅ `.opencode/skills/CORE/USER/FINANCES/README.md`
- ✅ `.opencode/skills/CORE/USER/REMINDERS.md`
- ✅ `.opencode/skills/CORE/USER/RESPONSEFORMAT.md`
- ✅ `.opencode/skills/CORE/USER/BASICINFO.md`
- ✅ `.opencode/skills/CORE/USER/TECHSTACKPREFERENCES.md`
- ✅ `.opencode/skills/CORE/SYSTEM/DOCUMENTATIONINDEX.md`
- ✅ `.opencode/skills/CORE/SYSTEM/PIPELINES.md`
- ✅ `.opencode/skills/CORE/SYSTEM/PAIAGENTSYSTEM.md`
- ✅ `.opencode/skills/CORE/SYSTEM/PAISYSTEMARCHITECTURE.md`
- ✅ `.opencode/skills/CORE/SYSTEM/SKILLSYSTEM.md`
- ✅ `.opencode/skills/CORE/SYSTEM/THEDELEGATIONSYSTEM.md`
- ✅ `.opencode/skills/CORE/SYSTEM/THENOTIFICATIONSYSTEM.md`
- ✅ `.opencode/skills/CORE/SYSTEM/UPDATES/2026-01-08_multi-channel-notification-system.md`
- ✅ `.opencode/skills/CORE/SYSTEM/THEHOOKSYSTEM.md`
- ✅ `.opencode/skills/CORE/SYSTEM/BROWSERAUTOMATION.md`
- ✅ `.opencode/skills/CORE/SYSTEM/BACKUPS.md`
- ✅ `.opencode/skills/CORE/SYSTEM/SCRAPINGREFERENCE.md`
- ✅ `.opencode/skills/CORE/SYSTEM/TERMINALTABS.md`
- ✅ `.opencode/skills/CORE/SYSTEM/MEMORYSYSTEM.md`
- ✅ `.opencode/skills/CORE/SYSTEM/CLIFIRSTARCHITECTURE.md`
- ✅ `.opencode/skills/CORE/SYSTEM/SYSTEM_USER_EXTENDABILITY.md`
- ✅ `.opencode/skills/CORE/SYSTEM/RESPONSEFORMAT.md`
- ✅ `.opencode/skills/CORE/SYSTEM/THEFABRICSYSTEM.md`
- ✅ `.opencode/skills/CORE/SYSTEM/TOOLS.md`
- ✅ `.opencode/skills/CORE/SKILL.md`
- ✅ `.opencode/skills/CreateCLI/Workflows/UpgradeTier.md`
- ✅ `.opencode/skills/CreateCLI/Workflows/AddCommand.md`
- ✅ `.opencode/skills/CreateCLI/Workflows/CreateCli.md`
- ✅ `.opencode/skills/CreateCLI/FrameworkComparison.md`
- ✅ `.opencode/skills/CreateCLI/Patterns.md`
- ✅ `.opencode/skills/CreateCLI/SKILL.md`
- ✅ `.opencode/skills/CreateCLI/TypescriptPatterns.md`
- ✅ `.opencode/skills/PAIUpgrade/sources.json`
- ✅ `.opencode/skills/PAIUpgrade/Tools/Anthropic.ts`
- ✅ `.opencode/skills/PAIUpgrade/youtube-channels.json`
- ✅ `.opencode/skills/PAIUpgrade/Workflows/FindSources.md`
- ✅ `.opencode/skills/PAIUpgrade/Workflows/ResearchUpgrade.md`
- ✅ `.opencode/skills/PAIUpgrade/Workflows/CheckForUpgrades.md`
- ✅ `.opencode/skills/PAIUpgrade/Workflows/ReleaseNotesDeepDive.md`
- ✅ `.opencode/skills/PAIUpgrade/SKILL.md`
- ✅ `.opencode/skills/Council/OutputFormat.md`
- ✅ `.opencode/skills/Council/Workflows/Debate.md`
- ✅ `.opencode/skills/Council/Workflows/Quick.md`
- ✅ `.opencode/skills/Council/RoundStructure.md`
- ✅ `.opencode/skills/Council/SKILL.md`
- ✅ `.opencode/skills/Council/CouncilMembers.md`
- ✅ `.opencode/skills/Prompting/Tools/RenderTemplate.ts`
- ✅ `.opencode/skills/Prompting/Tools/index.ts`
- ✅ `.opencode/skills/Prompting/Tools/ValidateTemplate.ts`
- ✅ `.opencode/skills/Prompting/SKILL.md`
- ✅ `.opencode/skills/Prompting/Templates/Evals/Rubric.hbs`
- ✅ `.opencode/skills/Prompting/Templates/Evals/Report.hbs`
- ✅ `.opencode/skills/Prompting/Templates/Evals/TestCase.hbs`
- ✅ `.opencode/skills/Prompting/Templates/Evals/Judge.hbs`
- ✅ `.opencode/skills/Prompting/Templates/Evals/Comparison.hbs`
- ✅ `.opencode/skills/Prompting/Templates/Tools/.cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc`
- ✅ `.opencode/skills/Prompting/Templates/Tools/bun.lock`
- ✅ `.opencode/skills/Prompting/Templates/Tools/RenderTemplate.ts`
- ✅ `.opencode/skills/Prompting/Templates/Tools/README.md`
- ✅ `.opencode/skills/Prompting/Templates/Tools/.gitignore`
- ✅ `.opencode/skills/Prompting/Templates/Tools/package.json`
- ✅ `.opencode/skills/Prompting/Templates/Tools/tsconfig.json`
- ✅ `.opencode/skills/Prompting/Templates/Tools/index.ts`
- ✅ `.opencode/skills/Prompting/Templates/Tools/ValidateTemplate.ts`
- ✅ `.opencode/skills/Prompting/Templates/Tools/CLAUDE.md`
- ✅ `.opencode/skills/Prompting/Templates/README.md`
- ✅ `.opencode/skills/Prompting/Templates/Primitives/Structure.hbs`
- ✅ `.opencode/skills/Prompting/Templates/Primitives/Roster.hbs`
- ✅ `.opencode/skills/Prompting/Templates/Primitives/Briefing.hbs`
- ✅ `.opencode/skills/Prompting/Templates/Primitives/Voice.hbs`
- ✅ `.opencode/skills/Prompting/Templates/Primitives/Gate.hbs`
- ✅ `.opencode/skills/Prompting/Templates/Data/Agents.yaml`
- ✅ `.opencode/skills/Prompting/Templates/Data/ValidationGates.yaml`
- ✅ `.opencode/skills/Prompting/Templates/Data/VoicePresets.yaml`
- ✅ `.opencode/skills/Prompting/Standards.md`
- ✅ `.opencode/skills/RedTeam/Integration.md`
- ✅ `.opencode/skills/RedTeam/Workflows/AdversarialValidation.md`
- ✅ `.opencode/skills/RedTeam/Workflows/ParallelAnalysis.md`
- ✅ `.opencode/skills/RedTeam/SKILL.md`
- ✅ `.opencode/skills/RedTeam/Philosophy.md`
- ✅ `.opencode/skills/Art/Tools/GenerateMidjourneyImage.ts`
- ✅ `.opencode/skills/Art/Tools/GeneratePrompt.ts`
- ✅ `.opencode/skills/Art/Tools/Generate.ts`
- ✅ `.opencode/skills/Art/Tools/ComposeThumbnail.ts`
- ✅ `.opencode/skills/Art/HeadshotExamples/headshot-pondering.png`
- ✅ `.opencode/skills/Art/HeadshotExamples/headshot-what-is-that.png`
- ✅ `.opencode/skills/Art/HeadshotExamples/headshot-smiling.png`
- ✅ `.opencode/skills/Art/HeadshotExamples/headshot-outside-smiling.png`
- ✅ `.opencode/skills/Art/HeadshotExamples/headshot-hat-smiling.png`
- ✅ `.opencode/skills/Art/HeadshotExamples/headshot-yuk.png`
- ✅ `.opencode/skills/Art/HeadshotExamples/headshot-whatthehell.png`
- ✅ `.opencode/skills/Art/HeadshotExamples/Screenshot 2024-05-14 at 09.52.31.png`
- ✅ `.opencode/skills/Art/HeadshotExamples/headshot-clean.png`
- ✅ `.opencode/skills/Art/HeadshotExamples/headshot-walking-cap-smiling.png`
- ✅ `.opencode/skills/Art/HeadshotExamples/headshot-nah.png`
- ✅ `.opencode/skills/Art/HeadshotExamples/headshot-surprised-hat.png`
- ✅ `.opencode/skills/Art/ThumbnailExamples/AudioEssay.png`
- ✅ `.opencode/skills/Art/ThumbnailExamples/InterviewVideo.png`
- ✅ `.opencode/skills/Art/ThumbnailExamples/RegularVideo4.png`
- ✅ `.opencode/skills/Art/ThumbnailExamples/RegularVideo5.png`
- ✅ `.opencode/skills/Art/ThumbnailExamples/RegularVideo2.png`
- ✅ `.opencode/skills/Art/ThumbnailExamples/RegularVideo3.png`
- ✅ `.opencode/skills/Art/ThumbnailExamples/RegularVideo1.png`
- ✅ `.opencode/skills/Art/YouTubeThumbnailExamples/Main2.png`
- ✅ `.opencode/skills/Art/YouTubeThumbnailExamples/Sponsored1.png`
- ✅ `.opencode/skills/Art/YouTubeThumbnailExamples/Main3.png`
- ✅ `.opencode/skills/Art/YouTubeThumbnailExamples/Main1.png`
- ✅ `.opencode/skills/Art/YouTubeThumbnailExamples/Sponsored3.png`
- ✅ `.opencode/skills/Art/YouTubeThumbnailExamples/SPECIFICATIONS.md`
- ✅ `.opencode/skills/Art/YouTubeThumbnailExamples/Sponsored2.png`
- ✅ `.opencode/skills/Art/YouTubeThumbnailExamples/Main4.png`
- ✅ `.opencode/skills/Art/YouTubeThumbnailExamples/Main5.png`
- ✅ `.opencode/skills/Art/YouTubeThumbnailExamples/Main7.png`
- ✅ `.opencode/skills/Art/YouTubeThumbnailExamples/Main6.png`
- ✅ `.opencode/skills/Art/YouTubeThumbnailExamples/Audio1.png`
- ✅ `.opencode/skills/Art/Workflows/Stats.md`
- ✅ `.opencode/skills/Art/Workflows/D3Dashboards.md`
- ✅ `.opencode/skills/Art/Workflows/Frameworks.md`
- ✅ `.opencode/skills/Art/Workflows/Taxonomies.md`
- ✅ `.opencode/skills/Art/Workflows/AdHocYouTubeThumbnail.md`
- ✅ `.opencode/skills/Art/Workflows/Aphorisms.md`
- ✅ `.opencode/skills/Art/Workflows/Timelines.md`
- ✅ `.opencode/skills/Art/Workflows/Essay.md`
- ✅ `.opencode/skills/Art/Workflows/Comics.md`
- ✅ `.opencode/skills/Art/Workflows/TechnicalDiagrams.md`
- ✅ `.opencode/skills/Art/Workflows/Comparisons.md`
- ✅ `.opencode/skills/Art/Workflows/Maps.md`
- ✅ `.opencode/skills/Art/Workflows/Visualize.md`
- ✅ `.opencode/skills/Art/Workflows/Mermaid.md`
- ✅ `.opencode/skills/Art/Workflows/CreatePAIPackIcon.md`
- ✅ `.opencode/skills/Art/Workflows/RecipeCards.md`
- ✅ `.opencode/skills/Art/Workflows/AnnotatedScreenshots.md`
- ✅ `.opencode/skills/Art/Examples/human-linear-style2.png`
- ✅ `.opencode/skills/Art/Examples/setting-line-style.png`
- ✅ `.opencode/skills/Art/Examples/setting-line-style2.png`
- ✅ `.opencode/skills/Art/Examples/human-linear-form.png`
- ✅ `.opencode/skills/Art/SKILL.md`
- ✅ `.opencode/skills/Art/Lib/discord-bot.ts`
- ✅ `.opencode/skills/Art/Lib/midjourney-client.ts`
- ✅ `.opencode/skills/BrightData/Workflows/FourTierScrape.md`
- ✅ `.opencode/skills/BrightData/SKILL.md`
- ✅ `.opencode/skills/PrivateInvestigator/Workflows/ReverseLookup.md`
- ✅ `.opencode/skills/PrivateInvestigator/Workflows/FindPerson.md`
- ✅ `.opencode/skills/PrivateInvestigator/Workflows/VerifyIdentity.md`
- ✅ `.opencode/skills/PrivateInvestigator/Workflows/SocialMediaSearch.md`
- ✅ `.opencode/skills/PrivateInvestigator/Workflows/PublicRecordsSearch.md`
- ✅ `.opencode/skills/PrivateInvestigator/SKILL.md`
- ✅ `.opencode/skills/CreateSkill/Workflows/ValidateSkill.md`
- ✅ `.opencode/skills/CreateSkill/Workflows/CreateSkill.md`
- ✅ `.opencode/skills/CreateSkill/Workflows/UpdateSkill.md`
- ✅ `.opencode/skills/CreateSkill/Workflows/CanonicalizeSkill.md`
- ✅ `.opencode/skills/CreateSkill/SKILL.md`
- ✅ `.opencode/skills/Agents/Tools/SpawnAgentWithProfile.ts`
- ✅ `.opencode/skills/Agents/Tools/LoadAgentContext.ts`
- ✅ `.opencode/skills/Agents/Tools/AgentFactory.ts`
- ✅ `.opencode/skills/Agents/Tools/bun.lock`
- ✅ `.opencode/skills/Agents/Tools/package.json`
- ✅ `.opencode/skills/Agents/ArchitectContext.md`
- ✅ `.opencode/skills/Agents/REDESIGN-SUMMARY.md`
- ✅ `.opencode/skills/Agents/AgentProfileSystem.md`
- ✅ `.opencode/skills/Agents/Scratchpad/sparkline-color-analysis.md`
- ✅ `.opencode/skills/Agents/Workflows/CreateCustomAgent.md`
- ✅ `.opencode/skills/Agents/Workflows/ListTraits.md`
- ✅ `.opencode/skills/Agents/Workflows/SpawnParallelAgents.md`
- ✅ `.opencode/skills/Agents/AgentPersonalities.md`
- ✅ `.opencode/skills/Agents/ArtistContext.md`
- ✅ `.opencode/skills/Agents/SKILL.md`
- ✅ `.opencode/skills/Agents/EngineerContext.md`
- ✅ `.opencode/skills/Agents/CodexResearcherContext.md`
- ✅ `.opencode/skills/Agents/GrokResearcherContext.md`
- ✅ `.opencode/skills/Agents/Templates/DynamicAgent.hbs`
- ✅ `.opencode/skills/Agents/GeminiResearcherContext.md`
- ✅ `.opencode/skills/Agents/Data/Traits.yaml`
- ✅ `.opencode/skills/Agents/DesignerContext.md`
- ✅ `.opencode/skills/Agents/ClaudeResearcherContext.md`
- ✅ `.opencode/skills/Agents/QATesterContext.md`
- ✅ `.opencode/skills/OSINT/EthicalFramework.md`
- ✅ `.opencode/skills/OSINT/Methodology.md`
- ✅ `.opencode/skills/OSINT/Workflows/CompanyLookup.md`
- ✅ `.opencode/skills/OSINT/Workflows/CompanyDueDiligence.md`
- ✅ `.opencode/skills/OSINT/Workflows/PeopleLookup.md`
- ✅ `.opencode/skills/OSINT/Workflows/EntityLookup.md`
- ✅ `.opencode/skills/OSINT/PeopleTools.md`
- ✅ `.opencode/skills/OSINT/SKILL.md`
- ✅ `.opencode/skills/OSINT/CompanyTools.md`
- ✅ `.opencode/skills/OSINT/EntityTools.md`
- ✅ `.opencode/skills/System/Tools/UpdateSearch.ts`
- ✅ `.opencode/skills/System/Tools/ExtractArchitectureUpdates.ts`
- ✅ `.opencode/skills/System/Tools/UpdateIndex.ts`
- ✅ `.opencode/skills/System/Tools/CreateUpdate.ts`
- ✅ `.opencode/skills/System/Workflows/WorkContextRecall.md`
- ✅ `.opencode/skills/System/Workflows/DocumentSession.md`
- ✅ `.opencode/skills/System/Workflows/IntegrityCheck.md`
- ✅ `.opencode/skills/System/Workflows/SecretScanning.md`
- ✅ `.opencode/skills/System/Workflows/PrivacyCheck.md`
- ✅ `.opencode/skills/System/Workflows/DocumentRecent.md`
- ✅ `.opencode/skills/System/SKILL.md`
- ✅ `.opencode/skills/System/Templates/Update.md`
- ✅ `.opencode/skills/Browser/Tools/https:/danielmiessler.com/blog/introducing-amazon-curate-i-wish`
- ✅ `.opencode/skills/Browser/Tools/BrowserSession.ts`
- ✅ `.opencode/skills/Browser/Tools/Browse.ts`
- ✅ `.opencode/skills/Browser/Workflows/Extract.md`
- ✅ `.opencode/skills/Browser/Workflows/Interact.md`
- ✅ `.opencode/skills/Browser/Workflows/Screenshot.md`
- ✅ `.opencode/skills/Browser/Workflows/VerifyPage.md`
- ✅ `.opencode/skills/Browser/Workflows/Update.md`
- ✅ `.opencode/skills/Browser/bun.lock`
- ✅ `.opencode/skills/Browser/README.md`
- ✅ `.opencode/skills/Browser/http:/localhost:5173/ideas#the-full-archive`
- ✅ `.opencode/skills/Browser/http:/localhost:5173/ideas`
- ✅ `.opencode/skills/Browser/package.json`
- ✅ `.opencode/skills/Browser/examples/verify-page.ts`
- ✅ `.opencode/skills/Browser/examples/screenshot.ts`
- ✅ `.opencode/skills/Browser/examples/comprehensive-test.ts`
- ✅ `.opencode/skills/Browser/SKILL.md`
- ✅ `.opencode/skills/Browser/tsconfig.json`
- ✅ `.opencode/skills/Browser/index.ts`
- ✅ `.opencode/skills/FirstPrinciples/Workflows/Challenge.md`
- ✅ `.opencode/skills/FirstPrinciples/Workflows/Reconstruct.md`
- ✅ `.opencode/skills/FirstPrinciples/Workflows/Deconstruct.md`
- ✅ `.opencode/skills/FirstPrinciples/SKILL.md`
- ✅ `.opencode/skills/THEALGORITHM/Tools/RalphLoopExecutor.ts`
- ✅ `.opencode/skills/THEALGORITHM/Tools/EffortClassifier.ts`
- ✅ `.opencode/skills/THEALGORITHM/Tools/CapabilityLoader.ts`
- ✅ `.opencode/skills/THEALGORITHM/Tools/ISCManager.ts`
- ✅ `.opencode/skills/THEALGORITHM/Tools/TraitModifiers.ts`
- ✅ `.opencode/skills/THEALGORITHM/Tools/AlgorithmDisplay.ts`
- ✅ `.opencode/skills/THEALGORITHM/Tools/CapabilitySelector.ts`
- ✅ `.opencode/skills/THEALGORITHM/SKILL.md`
- ✅ `.opencode/skills/THEALGORITHM/Phases/Learn.md`
- ✅ `.opencode/skills/THEALGORITHM/Phases/Observe.md`
- ✅ `.opencode/skills/THEALGORITHM/Phases/Verify.md`
- ✅ `.opencode/skills/THEALGORITHM/Phases/Build.md`
- ✅ `.opencode/skills/THEALGORITHM/Phases/Plan.md`
- ✅ `.opencode/skills/THEALGORITHM/Phases/Think.md`
- ✅ `.opencode/skills/THEALGORITHM/Phases/Execute.md`
- ✅ `.opencode/skills/THEALGORITHM/Data/Capabilities.yaml`
- ✅ `.opencode/skills/THEALGORITHM/Data/VerificationMethods.yaml`
- ✅ `.opencode/skills/THEALGORITHM/Reference/ISCFormat.md`
- ✅ `.opencode/skills/THEALGORITHM/Reference/EffortMatrix.md`
- ✅ `.opencode/skills/THEALGORITHM/Reference/CapabilityMatrix.md`
- ✅ `.opencode/skills/Recon/Tools/WhoisParser.ts`
- ✅ `.opencode/skills/Recon/Tools/IpinfoClient.ts`
- ✅ `.opencode/skills/Recon/Tools/DnsUtils.ts`
- ✅ `.opencode/skills/Recon/Tools/SubdomainEnum.ts`
- ✅ `.opencode/skills/Recon/Tools/PortScan.ts`
- ✅ `.opencode/skills/Recon/Tools/CidrUtils.ts`
- ✅ `.opencode/skills/Recon/Tools/MassScan.ts`
- ✅ `.opencode/skills/Recon/Tools/PathDiscovery.ts`
- ✅ `.opencode/skills/Recon/Tools/CorporateStructure.ts`
- ✅ `.opencode/skills/Recon/Tools/EndpointDiscovery.ts`
- ✅ `.opencode/skills/Recon/Tools/BountyPrograms.ts`
- ✅ `.opencode/skills/Recon/Workflows/NetblockRecon.md`
- ✅ `.opencode/skills/Recon/Workflows/IpRecon.md`
- ✅ `.opencode/skills/Recon/Workflows/AnalyzeScanResultsGemini3.md`
- ✅ `.opencode/skills/Recon/Workflows/BountyPrograms.md`
- ✅ `.opencode/skills/Recon/Workflows/DomainRecon.md`
- ✅ `.opencode/skills/Recon/Workflows/UpdateTools.md`
- ✅ `.opencode/skills/Recon/Workflows/PassiveRecon.md`
- ✅ `.opencode/skills/Recon/README.md`
- ✅ `.opencode/skills/Recon/SKILL.md`
- ✅ `.opencode/skills/Recon/Data/BountyPrograms.json`
- ✅ `.opencode/skills/AnnualReports/Tools/UpdateSources.ts`
- ✅ `.opencode/skills/AnnualReports/Tools/ListSources.ts`
- ✅ `.opencode/skills/AnnualReports/Tools/FetchReport.ts`
- ✅ `.opencode/skills/AnnualReports/SKILL.md`
- ✅ `.opencode/agents/Artist.md`
- ✅ `.opencode/agents/QATester.md`
- ✅ `.opencode/agents/Architect.md`
- ✅ `.opencode/agents/Designer.md`
- ✅ `.opencode/agents/GeminiResearcher.md`
- ✅ `.opencode/agents/GrokResearcher.md`
- ✅ `.opencode/agents/CodexResearcher.md`
- ✅ `.opencode/agents/Pentester.md`
- ✅ `.opencode/agents/Intern.md`
- ✅ `.opencode/agents/Engineer.md`
- ✅ `.opencode/agents/ClaudeResearcher.md`
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
