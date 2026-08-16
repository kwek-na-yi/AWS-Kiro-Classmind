# Requirements Document

## Introduction

ClassMind is a web-based learning platform that turns uploaded lecture material into a personalised study experience and gives the class a shared, anonymous view of where understanding is weak.

The mandatory problem-statement flow is: upload lecture material, generate a structured AI recap with key takeaways, generate quiz questions. ClassMind differentiates on top of that flow with personalisation, an adaptive quiz, individual understanding analysis, an anonymous Class Understanding Map, misconception detection, a shared study space, and AI validation of peer explanations against the source material.

Scope constraints for this MVP:

- The MVP is built for a hackathon with a 4-minute live presentation and demo. Reliability of the end-to-end flow outranks feature quantity.
- AI-generated content is grounded in the uploaded Lecture_Material.
- Where behaviour can be expressed as deterministic rules (quiz difficulty selection, class aggregation, misconception candidate selection, gating of peer explanations), deterministic rules are used and AI is limited to natural-language generation.
- No machine learning model is trained or hosted by ClassMind. The system uses a hosted foundation model through Amazon Bedrock.
- Out of scope: social networking features, account/password/OAuth flows, notifications, leaderboards, native mobile applications, custom ML training, grading integrations, and instructor administration beyond creating a Class_Session.

> Note: `docs/product.md` is empty on disk (0 bytes). The requirements below are derived from the product brief supplied in the spec request. When `docs/product.md` is populated, this document should be reconciled against it.

## Glossary

- **ClassMind**: The complete system, comprising the Web_App and all backend services.
- **Web_App**: The browser-based user interface of ClassMind.
- **Instructor**: A user who creates a Class_Session and uploads Lecture_Material.
- **Learner**: A user who joins a Class_Session, reads a Recap, takes a Quiz_Session, and contributes to the Study_Space.
- **Class_Session**: A named container that owns one Lecture_Material, one Quiz_Pool, all Quiz_Sessions, all Study_Space content, and one Class_Understanding_Map. Identified by a human-readable Join_Code.
- **Join_Code**: A short alphanumeric string that identifies a Class_Session for joining purposes.
- **Display_Name**: A free-text label a Learner enters on joining a Class_Session, used only in the Study_Space.
- **Learner_Id**: A system-generated opaque identifier for a Learner within a Class_Session, stored in browser local storage.
- **Lecture_Material**: A single document uploaded by an Instructor, in PDF, TXT, or Markdown format.
- **Source_Text**: The plain-text content extracted from a Lecture_Material.
- **Topic**: A named subject area extracted from the Source_Text. Every Recap_Section, Quiz_Item, and Study_Thread references exactly one Topic.
- **Understanding_Level**: A Learner-selected value from the set {No_Understanding, Basic_Understanding, Strong_Understanding}, presented to the Learner as "No understanding", "Basic understanding", and "Strong understanding".
- **Explanation_Style**: A Learner-selected value from the set {Concise, Detailed, Examples, Step_By_Step, Visual_Structured}, presented to the Learner as "Concise", "Detailed", "Examples", "Step by step", and "Visual / diagrams".
- **Mermaid_Diagram**: A diagram expressed in Mermaid text syntax and rendered in the browser by the Web_App without an image generation service.
- **Learner_Profile**: The combination of a Learner's Understanding_Level and Explanation_Style for a Class_Session.
- **Recap**: A structured summary of a Lecture_Material generated for one Learner_Profile, composed of Recap_Sections and Key_Takeaways.
- **Recap_Section**: One Topic-scoped part of a Recap, containing explanatory prose and at least one Source_Reference.
- **Key_Takeaway**: A single-sentence statement of an essential point from the Lecture_Material.
- **Source_Reference**: A pointer to the location in the Source_Text that supports a generated statement, expressed as a page number for PDF material and a section or line range for TXT and Markdown material.
- **Quiz_Pool**: The set of Quiz_Items generated once per Lecture_Material.
- **Quiz_Item**: A multiple-choice question with exactly four Answer_Options, exactly one correct Answer_Option, a Topic, a Difficulty_Level, and a Source_Reference.
- **Answer_Option**: One selectable answer belonging to a Quiz_Item. An incorrect Answer_Option is a Distractor.
- **Distractor**: An incorrect Answer_Option, carrying a Misconception_Label that names the mistaken belief the Distractor represents.
- **Difficulty_Level**: An integer in the range 1 to 3, where 1 is foundational, 2 is intermediate, and 3 is advanced.
- **Quiz_Session**: One Learner's single pass through a fixed number of Quiz_Items in a Class_Session.
- **Quiz_Response**: One Learner's selected Answer_Option for one Quiz_Item within a Quiz_Session, with a correctness value and the Difficulty_Level served.
- **Adaptive_Quiz_Engine**: The deterministic component that selects the next Quiz_Item and maintains the Current_Difficulty of a Quiz_Session.
- **Current_Difficulty**: The Difficulty_Level the Adaptive_Quiz_Engine will serve next in a Quiz_Session.
- **Understanding_Report**: A per-Learner result produced at the end of a Quiz_Session, containing a Topic_Mastery value for each answered Topic, a list of Weak_Topics, and next-step guidance.
- **Topic_Mastery**: The proportion of correct Quiz_Responses for one Topic, expressed as a percentage rounded to the nearest integer.
- **Weak_Topic**: A Topic whose Topic_Mastery is below 60 percent for a given Learner.
- **Class_Understanding_Map**: An aggregated, anonymised view of Class_Mastery per Topic for a Class_Session.
- **Class_Mastery**: The proportion of correct Quiz_Responses for one Topic across all Learners in a Class_Session, expressed as a percentage rounded to the nearest integer.
- **Anonymity_Threshold**: The minimum number of distinct Learners who must have answered a Topic before Class_Mastery for the Topic is displayed. The Anonymity_Threshold is 3.
- **Misconception_Detector**: The component that identifies frequently selected Distractors and produces Misconception_Reports.
- **Misconception_Report**: A record naming a Topic, a selection percentage, a Misconception_Label, and a generated clarification grounded in the Source_Text.
- **Study_Space**: The shared area of a Class_Session where Learners read and contribute Peer_Explanations.
- **Study_Thread**: A Topic-scoped list of Peer_Explanations within a Study_Space.
- **Peer_Explanation**: A text contribution submitted by a Learner to a Study_Thread.
- **Explanation_Validator**: The component that assesses a Peer_Explanation against the Source_Text and assigns a Validation_Status.
- **Validation_Status**: A value from the set {Pending, Validated, Unsupported, Contradicted}.
- **Recommended_Explanations**: The list of Peer_Explanations that the Web_App presents as trustworthy study material for a Topic.
- **Fallback_Mode**: The degraded operating state entered for a specific generation task when a Bedrock request fails after all retries.

---

## Requirements

### Requirement 1: Create and Join a Class Session

**User Story:** As an Instructor, I want to create a Class_Session with a short Join_Code, so that Learners can reach the same lecture material without creating accounts.

#### Acceptance Criteria

1. WHEN an Instructor submits a Class_Session name, THE ClassMind SHALL create a Class_Session and return a Join_Code of 6 alphanumeric characters.
2. THE ClassMind SHALL generate each Join_Code so that the Join_Code is unique across all existing Class_Sessions.
3. WHEN a Learner submits a Join_Code that matches an existing Class_Session and a Display_Name of 1 to 30 characters, THE ClassMind SHALL create a Learner_Id, associate the Learner_Id with the Class_Session, and return the Class_Session content.
4. IF a Learner submits a Join_Code that matches no existing Class_Session, THEN THE ClassMind SHALL return a not-found error identifying the Join_Code as unrecognised.
5. WHEN a Learner_Id is created, THE Web_App SHALL store the Learner_Id in browser local storage.
6. WHILE a Learner_Id for a Class_Session is present in browser local storage, THE Web_App SHALL reuse the stored Learner_Id instead of creating a new Learner_Id.
7. THE ClassMind SHALL accept requests that carry a Learner_Id and a Class_Session identifier as sufficient authorisation for Learner actions within that Class_Session.

### Requirement 2: Upload Lecture Material

**User Story:** As an Instructor, I want to upload one lecture document, so that ClassMind can generate study material grounded in that document.

#### Acceptance Criteria

1. WHEN an Instructor selects a file with a PDF, TXT, or Markdown extension and a size of 20 MB or less, THE ClassMind SHALL store the file in Amazon S3 and associate the stored object with the Class_Session.
2. IF an Instructor selects a file whose extension is outside the set {PDF, TXT, Markdown}, THEN THE ClassMind SHALL reject the upload and return a message listing the accepted extensions.
3. IF an Instructor selects a file larger than 20 MB, THEN THE ClassMind SHALL reject the upload and return a message stating the 20 MB limit.
4. WHEN a Lecture_Material is stored, THE ClassMind SHALL extract Source_Text from the Lecture_Material and persist the Source_Text with a Source_Reference for each extracted unit.
5. IF Source_Text extraction produces fewer than 200 characters, THEN THE ClassMind SHALL mark the Lecture_Material as unprocessable and return a message stating that readable text was not found.
6. WHILE Source_Text extraction and Topic identification are in progress, THE Web_App SHALL display a progress indicator naming the current stage.
7. WHEN Source_Text is persisted, THE ClassMind SHALL identify between 3 and 8 Topics from the Source_Text and persist each Topic with at least one Source_Reference.
8. WHEN an Instructor uploads a second Lecture_Material to a Class_Session that already holds a Lecture_Material, THE ClassMind SHALL replace the existing Lecture_Material, Topics, and Quiz_Pool, and delete the existing Quiz_Sessions, Understanding_Reports, Misconception_Reports, and Peer_Explanations for that Class_Session.

### Requirement 3: Select Understanding Level and Explanation Style

**User Story:** As a Learner, I want to state how well I already understand the material and how I prefer explanations, so that the recap matches my needs.

#### Acceptance Criteria

1. WHEN a Learner opens a Class_Session for the first time, THE Web_App SHALL present the three Understanding_Level values and the five Explanation_Style values as selectable choices.
2. THE Web_App SHALL require one Understanding_Level selection and one Explanation_Style selection before requesting a Recap.
3. WHEN a Learner confirms an Understanding_Level and an Explanation_Style, THE ClassMind SHALL persist the values as the Learner_Profile for that Learner_Id and Class_Session.
4. WHEN a Learner changes the Understanding_Level or the Explanation_Style, THE ClassMind SHALL persist the new Learner_Profile and generate a Recap for the new Learner_Profile.
5. THE ClassMind SHALL retain each generated Recap keyed by Class_Session, Understanding_Level, and Explanation_Style.
6. WHEN a Recap for the requested Class_Session, Understanding_Level, and Explanation_Style already exists, THE ClassMind SHALL return the retained Recap without issuing a Bedrock request.

### Requirement 4: Generate a Personalised Structured Recap

**User Story:** As a Learner, I want a structured recap with key takeaways written for my level and preferred style, so that I can understand the lecture faster than by rereading the source document.

#### Acceptance Criteria

1. WHEN a Learner requests a Recap, THE ClassMind SHALL generate the Recap through Amazon Bedrock using the Source_Text of the Class_Session Lecture_Material as the only content source.
2. THE ClassMind SHALL produce one Recap_Section for each identified Topic of the Class_Session.
3. THE ClassMind SHALL produce between 3 and 7 Key_Takeaways for each Recap, each Key_Takeaway expressed as a single sentence.
4. THE ClassMind SHALL attach at least one Source_Reference to each Recap_Section.
5. WHERE the Learner_Profile Understanding_Level is No_Understanding, THE ClassMind SHALL instruct Bedrock to assume no prior exposure to the Topic, to define every domain term on first use, and to open each Recap_Section with a plain-language statement of what the Topic is and why the Topic matters.
6. WHERE the Learner_Profile Understanding_Level is Basic_Understanding, THE ClassMind SHALL instruct Bedrock to assume familiarity with the Topic names, to define only terms that the Source_Text introduces beyond the Topic names, and to state how the concepts of the Topic relate to one another.
7. WHERE the Learner_Profile Understanding_Level is Strong_Understanding, THE ClassMind SHALL instruct Bedrock to omit introductory definitions and to include the edge cases, qualifications, and precise conditions stated in the Source_Text.
8. WHERE the Learner_Profile Explanation_Style is Concise, THE ClassMind SHALL instruct Bedrock to express each Recap_Section as bullet points totalling 80 words or fewer.
9. WHERE the Learner_Profile Explanation_Style is Detailed, THE ClassMind SHALL instruct Bedrock to express each Recap_Section as prose of 250 words or fewer that states the mechanism of the Topic and the reasoning behind the mechanism.
10. WHERE the Learner_Profile Explanation_Style is Examples, THE ClassMind SHALL instruct Bedrock to include at least one worked example in each Recap_Section, drawn from the Source_Text or constructed from the Source_Text.
11. WHERE the Learner_Profile Explanation_Style is Step_By_Step, THE ClassMind SHALL instruct Bedrock to express each Recap_Section as an ordered sequence of numbered steps.
12. WHERE the Learner_Profile Explanation_Style is Visual_Structured, THE ClassMind SHALL instruct Bedrock to express each Recap_Section as one labelled table, one ordered pipeline of named stages, or one Mermaid_Diagram, and SHALL generate the Recap_Section without an image generation service.
13. WHERE the Learner_Profile Explanation_Style is Visual_Structured, THE ClassMind SHALL instruct Bedrock to accompany each structured artefact with a prose form of the same Recap_Section content and SHALL persist the prose form with the Recap_Section.
14. THE ClassMind SHALL instruct Bedrock to restrict Recap content to statements supported by the Source_Text and to report a Topic as uncovered when the Source_Text lacks supporting content.
15. IF a generated Recap contains a Recap_Section without a Source_Reference, THEN THE ClassMind SHALL mark the Recap_Section as unverified and THE Web_App SHALL display an unverified indicator on that Recap_Section.
16. THE Web_App SHALL display the Recap as a Key_Takeaways list followed by one collapsible panel per Recap_Section, with the Topic name as the panel heading.

### Requirement 5: Generate a Grounded Quiz Pool

**User Story:** As a Learner, I want quiz questions drawn from the lecture material at several difficulty levels, so that I can test my understanding of what was actually taught.

#### Acceptance Criteria

1. WHEN a Lecture_Material has been processed into Topics, THE ClassMind SHALL generate one Quiz_Pool for the Class_Session through Amazon Bedrock using the Source_Text as the only content source.
2. THE ClassMind SHALL generate a Quiz_Pool containing at least 4 Quiz_Items for each Difficulty_Level in the range 1 to 3.
3. THE ClassMind SHALL generate each Quiz_Item with exactly 4 Answer_Options, exactly 1 correct Answer_Option, 1 Topic drawn from the Class_Session Topics, 1 Difficulty_Level, and 1 Source_Reference.
4. THE ClassMind SHALL generate each Distractor with a Misconception_Label stating the mistaken belief that the Distractor represents.
5. IF a generated Quiz_Item has a count of correct Answer_Options other than 1, a count of Answer_Options other than 4, a Topic outside the Class_Session Topics, or a missing Source_Reference, THEN THE ClassMind SHALL discard the Quiz_Item and exclude the Quiz_Item from the Quiz_Pool.
6. IF the Quiz_Pool contains fewer than 2 valid Quiz_Items for a Difficulty_Level after generation, THEN THE ClassMind SHALL issue one regeneration request restricted to that Difficulty_Level.
7. THE ClassMind SHALL generate the Quiz_Pool once per Lecture_Material and SHALL serve all Quiz_Sessions of the Class_Session from the retained Quiz_Pool.

### Requirement 6: Take an Adaptive Quiz

**User Story:** As a Learner, I want the quiz to get harder when I answer correctly and easier when I struggle, so that the quiz stays useful instead of frustrating or trivial.

#### Acceptance Criteria

1. WHEN a Learner starts a Quiz_Session, THE Adaptive_Quiz_Engine SHALL create the Quiz_Session with a Current_Difficulty of 2 and a length of 6 Quiz_Items.
2. WHEN the Adaptive_Quiz_Engine serves a Quiz_Item, THE Adaptive_Quiz_Engine SHALL select an unserved Quiz_Item of the Current_Difficulty from the Quiz_Pool.
3. IF no unserved Quiz_Item of the Current_Difficulty exists, THEN THE Adaptive_Quiz_Engine SHALL select an unserved Quiz_Item of the nearest available Difficulty_Level, preferring the lower Difficulty_Level when two Difficulty_Levels are equally near.
4. WHEN a Learner submits a Quiz_Response, THE Adaptive_Quiz_Engine SHALL persist the Quiz_Response with the Quiz_Item identifier, the selected Answer_Option, the correctness value, the Difficulty_Level served, and the submission timestamp.
5. WHEN two consecutive Quiz_Responses in a Quiz_Session are correct, THE Adaptive_Quiz_Engine SHALL increase the Current_Difficulty by 1 and reset the consecutive-response count to 0.
6. WHEN two consecutive Quiz_Responses in a Quiz_Session are incorrect, THE Adaptive_Quiz_Engine SHALL decrease the Current_Difficulty by 1 and reset the consecutive-response count to 0.
7. THE Adaptive_Quiz_Engine SHALL constrain the Current_Difficulty to the range 1 to 3.
8. THE Adaptive_Quiz_Engine SHALL determine the Current_Difficulty from the persisted Quiz_Responses of the Quiz_Session without issuing a Bedrock request.
9. WHEN a Learner submits a Quiz_Response, THE Web_App SHALL display the correct Answer_Option, the Source_Reference of the Quiz_Item, and the Difficulty_Level of the next Quiz_Item.
10. WHEN the count of Quiz_Responses in a Quiz_Session reaches 6, THE ClassMind SHALL close the Quiz_Session and produce the Understanding_Report.
11. IF a Learner submits a Quiz_Response for a Quiz_Item that already holds a Quiz_Response in the same Quiz_Session, THEN THE ClassMind SHALL retain the first Quiz_Response and return the existing Quiz_Session state.

### Requirement 7: Receive Individual Understanding Analysis

**User Story:** As a Learner, I want to see which topics I understand and which I do not after the quiz, so that I know what to study next.

#### Acceptance Criteria

1. WHEN a Quiz_Session closes, THE ClassMind SHALL compute a Topic_Mastery value for each Topic that holds at least one Quiz_Response in the Quiz_Session.
2. THE ClassMind SHALL compute Topic_Mastery as the count of correct Quiz_Responses for the Topic divided by the count of Quiz_Responses for the Topic, expressed as a percentage rounded to the nearest integer.
3. THE ClassMind SHALL classify each Topic with a Topic_Mastery below 60 percent as a Weak_Topic in the Understanding_Report.
4. THE ClassMind SHALL include the highest Difficulty_Level answered correctly in the Understanding_Report.
5. WHEN an Understanding_Report contains at least one Weak_Topic, THE ClassMind SHALL generate next-step guidance through Amazon Bedrock that names each Weak_Topic and cites the Source_Reference of the corresponding Recap_Section.
6. THE Web_App SHALL display the Understanding_Report with per-Topic Topic_Mastery values, the Weak_Topic list, and a link from each Weak_Topic to the matching Recap_Section and Study_Thread.
7. THE ClassMind SHALL compute all Topic_Mastery and Weak_Topic values with deterministic arithmetic and without a Bedrock request.

### Requirement 8: View the Anonymous Class Understanding Map

**User Story:** As an Instructor or Learner, I want to see which topics the class as a whole struggles with, so that teaching and studying can focus on those topics without exposing any individual's results.

#### Acceptance Criteria

1. WHEN a Class_Understanding_Map is requested, THE ClassMind SHALL compute Class_Mastery for each Topic of the Class_Session from all persisted Quiz_Responses of that Class_Session.
2. THE ClassMind SHALL compute Class_Mastery as the count of correct Quiz_Responses for the Topic across all Learners divided by the count of Quiz_Responses for the Topic across all Learners, expressed as a percentage rounded to the nearest integer.
3. THE ClassMind SHALL exclude Learner_Id values, Display_Name values, and individual Quiz_Response records from every Class_Understanding_Map response.
4. IF the count of distinct Learners holding a Quiz_Response for a Topic is below the Anonymity_Threshold, THEN THE ClassMind SHALL report the Topic with a status of insufficient-data and SHALL omit the Class_Mastery value for that Topic.
5. THE ClassMind SHALL include the count of distinct responding Learners for each Topic that meets the Anonymity_Threshold.
6. THE Web_App SHALL display each Topic of the Class_Understanding_Map with a colour band derived from the Class_Mastery value, using one band for values below 50 percent, one band for values from 50 to 74 percent, and one band for values from 75 to 100 percent.
7. THE Web_App SHALL order the Class_Understanding_Map Topics by ascending Class_Mastery so that the weakest Topic appears first.
8. THE ClassMind SHALL compute the Class_Understanding_Map with deterministic arithmetic and without a Bedrock request.

### Requirement 9: Detect Common Misconceptions

**User Story:** As an Instructor, I want to see the specific wrong beliefs the class holds, so that I can correct those beliefs directly.

#### Acceptance Criteria

1. WHEN a Class_Understanding_Map is requested, THE Misconception_Detector SHALL compute, for each Distractor of each served Quiz_Item, the selection percentage as the count of Quiz_Responses selecting the Distractor divided by the count of Quiz_Responses for the Quiz_Item.
2. THE Misconception_Detector SHALL classify a Distractor as a misconception candidate when the selection percentage is 30 percent or greater and the count of Quiz_Responses selecting the Distractor is 2 or greater.
3. THE Misconception_Detector SHALL rank misconception candidates by descending selection percentage and SHALL retain at most the 3 highest-ranked candidates for each Class_Session.
4. WHEN a misconception candidate is retained, THE ClassMind SHALL generate a Misconception_Report through Amazon Bedrock containing a clarification that states the correct position and cites the Source_Reference of the Quiz_Item.
5. THE ClassMind SHALL exclude Learner_Id values and Display_Name values from every Misconception_Report.
6. IF no Distractor meets the misconception candidate thresholds, THEN THE Web_App SHALL display a message stating that no shared misconception was detected.
7. THE Misconception_Detector SHALL select misconception candidates with deterministic arithmetic and without a Bedrock request.

### Requirement 10: Contribute and Read Peer Explanations

**User Story:** As a Learner, I want to write my own explanation of a difficult topic and read explanations written by classmates, so that the class can help each other on the weakest topics.

#### Acceptance Criteria

1. THE ClassMind SHALL provide one Study_Thread for each Topic of a Class_Session.
2. WHEN a Learner submits a Peer_Explanation of 20 to 1500 characters to a Study_Thread, THE ClassMind SHALL persist the Peer_Explanation with the Learner Display_Name, the Topic, the submission timestamp, and a Validation_Status of Pending.
3. IF a Learner submits a Peer_Explanation shorter than 20 characters or longer than 1500 characters, THEN THE ClassMind SHALL reject the submission and return a message stating the accepted length range.
4. THE Web_App SHALL order Study_Threads by ascending Class_Mastery so that the Topic the class finds hardest appears first.
5. THE Web_App SHALL display each Peer_Explanation with the Display_Name of the contributing Learner and the Validation_Status of the Peer_Explanation.
6. WHEN a Learner opens a Weak_Topic from an Understanding_Report, THE Web_App SHALL display the Study_Thread for that Topic.

### Requirement 11: Validate Peer Explanations Against Source Material

**User Story:** As a Learner, I want peer explanations checked against the lecture material before they are recommended, so that I do not study from a classmate's mistake.

#### Acceptance Criteria

1. WHEN a Peer_Explanation is persisted, THE Explanation_Validator SHALL assess the Peer_Explanation against the Source_Text of the Class_Session through Amazon Bedrock and SHALL assign a Validation_Status of Validated, Unsupported, or Contradicted.
2. THE Explanation_Validator SHALL assign Validated when every claim in the Peer_Explanation is supported by the Source_Text.
3. THE Explanation_Validator SHALL assign Contradicted when at least one claim in the Peer_Explanation conflicts with the Source_Text.
4. THE Explanation_Validator SHALL assign Unsupported when the Peer_Explanation contains a claim that the Source_Text neither supports nor contradicts.
5. WHEN the Explanation_Validator assigns a Validation_Status of Validated, THE ClassMind SHALL persist the supporting Source_Reference with the Peer_Explanation.
6. WHEN the Explanation_Validator assigns a Validation_Status of Contradicted or Unsupported, THE ClassMind SHALL persist a reason of 1 to 300 characters stating the unsupported or conflicting claim.
7. THE ClassMind SHALL restrict Recommended_Explanations for a Topic to Peer_Explanations whose Validation_Status is Validated.
8. WHILE a Peer_Explanation holds a Validation_Status of Pending, THE Web_App SHALL display the Peer_Explanation with a checking indicator and SHALL exclude the Peer_Explanation from Recommended_Explanations.
9. WHEN a Peer_Explanation holds a Validation_Status of Contradicted, THE Web_App SHALL display the Peer_Explanation with a conflict indicator and the persisted reason.
10. THE ClassMind SHALL retain every Peer_Explanation regardless of Validation_Status.

### Requirement 12: Continue Operating When AI Generation Fails

**User Story:** As a presenter, I want ClassMind to stay usable when a Bedrock request fails, so that a live demo continues instead of stopping on an error screen.

#### Acceptance Criteria

1. IF a Bedrock request fails, THEN THE ClassMind SHALL retry the Bedrock request at most 2 times with an increasing delay before entering Fallback_Mode for that task.
2. IF a Bedrock request returns content that fails schema validation, THEN THE ClassMind SHALL issue at most 1 repair request before entering Fallback_Mode for that task.
3. WHILE Fallback_Mode applies to Recap generation, THE ClassMind SHALL return a Recap composed of the Topic list and extracted Source_Text excerpts per Topic, marked as a source extract rather than a generated Recap.
4. WHILE Fallback_Mode applies to Quiz_Pool generation, THE ClassMind SHALL return the retained Quiz_Pool when a retained Quiz_Pool exists for the Class_Session.
5. IF Fallback_Mode applies to Quiz_Pool generation and no retained Quiz_Pool exists, THEN THE Web_App SHALL display a message stating that quiz generation is unavailable and SHALL keep the Recap and Class_Understanding_Map views reachable.
6. WHILE Fallback_Mode applies to Understanding_Report guidance generation, THE ClassMind SHALL return the Understanding_Report with computed Topic_Mastery values, Weak_Topics, and links to the matching Recap_Sections, and SHALL omit the generated guidance text.
7. WHILE Fallback_Mode applies to Misconception_Report generation, THE ClassMind SHALL return each retained misconception candidate with the Topic, the selection percentage, and the Misconception_Label, and SHALL omit the generated clarification.
8. WHILE Fallback_Mode applies to Peer_Explanation validation, THE ClassMind SHALL retain the Validation_Status of Pending and THE Web_App SHALL display a message stating that validation is delayed.
9. WHEN ClassMind enters Fallback_Mode for a task, THE Web_App SHALL display a notice naming the degraded task and SHALL keep every other view reachable.
10. WHEN ClassMind enters Fallback_Mode for a task, THE ClassMind SHALL record the task name, the Class_Session identifier, and the failure reason in Amazon CloudWatch Logs.
11. IF a Mermaid_Diagram in a Recap_Section fails to parse, THEN THE Web_App SHALL display the persisted prose form of that Recap_Section in place of the Mermaid_Diagram.
12. WHILE Fallback_Mode applies to Recap generation and the Learner_Profile Explanation_Style is Visual_Structured, THE ClassMind SHALL return the Topic-scoped Source_Text excerpts in prose form marked as a source extract.

---

## Non-Functional Requirements

### Requirement 13: Demo Latency Budget

**User Story:** As a presenter, I want each step of the flow to complete inside a known time budget, so that the full demo fits in a 4-minute presentation.

#### Acceptance Criteria

1. WHEN a Lecture_Material of 20 pages or fewer is uploaded, THE ClassMind SHALL complete storage, Source_Text extraction, and Topic identification within 15 seconds.
2. WHEN a Learner requests a Recap that requires generation, THE ClassMind SHALL return the Recap within 20 seconds.
3. WHEN a Learner requests a retained Recap, THE ClassMind SHALL return the Recap within 1 second.
4. WHEN a Learner submits a Quiz_Response, THE ClassMind SHALL persist the Quiz_Response and return the next Quiz_Item within 1 second.
5. WHEN a Quiz_Session closes, THE ClassMind SHALL return the Understanding_Report within 10 seconds.
6. WHEN a Class_Understanding_Map is requested, THE ClassMind SHALL return the Class_Mastery values within 2 seconds.
7. WHEN a Peer_Explanation is submitted, THE ClassMind SHALL acknowledge the submission within 1 second and SHALL resolve the Validation_Status within 15 seconds.
8. WHILE a request that exceeds 1 second is in progress, THE Web_App SHALL display a progress indicator naming the current stage.
9. THE ClassMind SHALL support 10 concurrent Learners in one Class_Session while meeting the response times stated in this requirement.

### Requirement 14: Grounding of Generated Content

**User Story:** As a Learner, I want every generated statement traceable to the uploaded material, so that I can trust the study content.

#### Acceptance Criteria

1. THE ClassMind SHALL include the Source_Text of the Class_Session Lecture_Material in every Bedrock request that produces a Recap, a Quiz_Item, a Misconception_Report clarification, Understanding_Report guidance, or a Validation_Status.
2. THE ClassMind SHALL instruct Bedrock to derive output only from the supplied Source_Text and to report missing coverage instead of supplying outside knowledge.
3. THE ClassMind SHALL require a Source_Reference on every Recap_Section and every Quiz_Item and SHALL mark generated content that lacks a Source_Reference as unverified.
4. THE ClassMind SHALL validate every Bedrock response against a declared output schema before persisting the response.
5. THE Web_App SHALL display the Source_Reference alongside each Recap_Section, each Quiz_Item explanation, and each Validated Peer_Explanation.

### Requirement 15: Anonymity of Class-Level Data

**User Story:** As a Learner, I want class-level results to reveal nothing about me individually, so that I answer honestly.

#### Acceptance Criteria

1. THE ClassMind SHALL exclude Learner_Id values, Display_Name values, Quiz_Response timestamps, and individual Quiz_Response records from every Class_Understanding_Map response and every Misconception_Report response.
2. THE ClassMind SHALL restrict every response that contains individual Quiz_Responses, Topic_Mastery values, or an Understanding_Report to requests carrying the matching Learner_Id.
3. IF a request for an Understanding_Report carries a Learner_Id other than the Learner_Id that owns the Understanding_Report, THEN THE ClassMind SHALL return an authorisation error and SHALL exclude the Understanding_Report from the response.
4. THE ClassMind SHALL apply the Anonymity_Threshold to every aggregate value published to a Class_Understanding_Map or a Misconception_Report.
5. THE Web_App SHALL display a statement on the Class_Understanding_Map view that class results are aggregated and contain no individual identity.

### Requirement 16: Lightweight Identity

**User Story:** As a Learner, I want to start studying by entering a code and a name, so that no sign-up step stands between me and the material.

#### Acceptance Criteria

1. THE ClassMind SHALL admit a Learner to a Class_Session on the basis of a Join_Code and a Display_Name, without a password, an email address, or a third-party identity provider.
2. THE ClassMind SHALL treat the Learner_Id as an opaque identifier that carries no personal data.
3. THE ClassMind SHALL scope every Learner_Id to a single Class_Session.
4. THE ClassMind SHALL reject requests that reference a Class_Session identifier and a Learner_Id that are not associated with each other.
5. THE ClassMind SHALL restrict Lecture_Material upload and replacement for a Class_Session to requests carrying the Instructor token issued at Class_Session creation.

### Requirement 17: Determinism and Reliability

**User Story:** As a hackathon team, I want scoring, aggregation, and selection logic to be deterministic, so that the demo produces the same result on every run.

#### Acceptance Criteria

1. THE ClassMind SHALL implement Current_Difficulty transitions, Quiz_Item selection, Topic_Mastery computation, Class_Mastery computation, Weak_Topic classification, misconception candidate selection, and Recommended_Explanations gating as deterministic functions of persisted data.
2. WHEN the same persisted Quiz_Responses are supplied, THE ClassMind SHALL produce identical Understanding_Report, Class_Understanding_Map, and misconception candidate values.
3. THE ClassMind SHALL restrict Bedrock usage to natural-language generation and Peer_Explanation assessment.
4. THE ClassMind SHALL describe generated content as AI-generated and SHALL exclude claims of machine learning model training from the Web_App.
5. THE ClassMind SHALL persist every generation result so that a repeated view of the same content requires no new Bedrock request.

### Requirement 18: Interface Quality

**User Story:** As a judge, I want ClassMind to present as a purpose-built learning platform, so that the product reads as finished rather than as a chat wrapper.

#### Acceptance Criteria

1. THE Web_App SHALL present ClassMind as four named views: Lecture, Recap, Quiz, and Class Insight.
2. THE Web_App SHALL exclude a free-form chat input from every view.
3. THE Web_App SHALL apply one typographic scale and one colour palette across every view.
4. THE Web_App SHALL render every view at a viewport width of 1280 pixels without horizontal scrolling.
5. WHEN a view holds no data yet, THE Web_App SHALL display an empty state naming the action that produces the data.
6. WHEN an error is returned, THE Web_App SHALL display the error within the current view and SHALL keep navigation to every other view available.
7. THE Web_App SHALL provide a text label for every colour-coded Class_Understanding_Map band so that the band meaning does not depend on colour perception.
8. THE Web_App SHALL support keyboard operation of every control and SHALL expose an accessible name for every control.
9. THE Web_App SHALL provide a text alternative for every Mermaid_Diagram and every labelled table rendered in a Recap_Section so that the Recap_Section content does not depend on visual layout.

---

## User Flows

### Flow A: Instructor prepares a Class_Session

1. The Instructor opens the Web_App and submits a Class_Session name.
2. ClassMind returns a Join_Code and an Instructor token.
3. The Instructor uploads a Lecture_Material.
4. ClassMind stores the file in Amazon S3, extracts Source_Text, identifies Topics, and generates the Quiz_Pool.
5. The Web_App displays the Topic list and the Join_Code for sharing.

### Flow B: Learner studies and takes the adaptive quiz

1. The Learner opens the Web_App, enters the Join_Code and a Display_Name, and joins the Class_Session.
2. The Learner selects an Understanding_Level and an Explanation_Style.
3. ClassMind returns a Recap containing Key_Takeaways and one Recap_Section per Topic, each with a Source_Reference.
4. The Learner starts a Quiz_Session and answers 6 Quiz_Items. The Adaptive_Quiz_Engine raises the Current_Difficulty after two consecutive correct Quiz_Responses and lowers the Current_Difficulty after two consecutive incorrect Quiz_Responses.
5. ClassMind closes the Quiz_Session and returns the Understanding_Report with Topic_Mastery values, Weak_Topics, and links into the Recap and the Study_Space.

### Flow C: Class insight

1. A Learner or the Instructor opens the Class Insight view.
2. ClassMind computes Class_Mastery per Topic from all Quiz_Responses, suppresses Topics below the Anonymity_Threshold, and returns the Class_Understanding_Map ordered weakest first.
3. The Misconception_Detector selects up to 3 misconception candidates and ClassMind returns a Misconception_Report for each, with a clarification citing the Source_Text.
4. The Web_App displays the Class_Understanding_Map and the Misconception_Reports with no individual identity present.

### Flow D: Shared study space and validation

1. The Learner opens the Study_Thread for a Weak_Topic.
2. The Learner submits a Peer_Explanation. ClassMind persists the Peer_Explanation with a Validation_Status of Pending and the Web_App shows a checking indicator.
3. The Explanation_Validator assesses the Peer_Explanation against the Source_Text and assigns Validated, Unsupported, or Contradicted.
4. The Web_App moves a Validated Peer_Explanation into Recommended_Explanations with the supporting Source_Reference, and labels an Unsupported or Contradicted Peer_Explanation with the persisted reason.

### Flow E: Degraded operation

1. A Bedrock request fails after retries during Recap generation.
2. ClassMind enters Fallback_Mode for Recap generation and returns Topic-scoped Source_Text excerpts marked as a source extract.
3. The Web_App displays a notice naming the degraded task and keeps the Quiz and Class Insight views reachable.
4. The Learner completes the Quiz_Session and views the Class_Understanding_Map, both of which are computed without a Bedrock request.

---

## Correctness Properties

These properties are stated for property-based testing during design and implementation. Each property names the requirement it verifies.

### Adaptive quiz difficulty (Requirement 6, Requirement 17)

1. **Bounded difficulty invariant**: For all sequences of Quiz_Responses, the Current_Difficulty remains within the range 1 to 3.
2. **Single-step invariant**: For all sequences of Quiz_Responses, the Current_Difficulty changes by at most 1 between consecutive Quiz_Responses.
3. **Monotone ascent**: For all sequences in which every Quiz_Response is correct, the Current_Difficulty is non-decreasing across the sequence.
4. **Monotone descent**: For all sequences in which every Quiz_Response is incorrect, the Current_Difficulty is non-increasing across the sequence.
5. **Determinism**: For all sequences of Quiz_Responses, replaying the sequence produces the same Current_Difficulty and the same served Quiz_Item order.
6. **No repetition**: For all Quiz_Sessions, no Quiz_Item is served twice while an unserved Quiz_Item exists in the Quiz_Pool.
7. **Session length**: For all Quiz_Sessions with a Quiz_Pool of at least 6 valid Quiz_Items, the closed Quiz_Session holds exactly 6 Quiz_Responses.

### Aggregation arithmetic (Requirement 7, Requirement 8, Requirement 17)

8. **Range invariant**: For all sets of Quiz_Responses, every Topic_Mastery value and every Class_Mastery value lies within the range 0 to 100.
9. **Boundary agreement**: For all sets of Quiz_Responses in which every Quiz_Response for a Topic is correct, Class_Mastery for the Topic is 100; where every Quiz_Response for the Topic is incorrect, Class_Mastery for the Topic is 0.
10. **Response conservation**: For all Class_Sessions, the sum of per-Topic Quiz_Response counts equals the total count of persisted Quiz_Responses for the Class_Session.
11. **Order independence**: For all permutations of a set of Quiz_Responses, the computed Class_Understanding_Map is identical.
12. **Weak topic consistency**: For all Understanding_Reports, a Topic appears in the Weak_Topic list if and only if the Topic_Mastery for that Topic is below 60.
13. **Ordering**: For all Class_Understanding_Maps, the displayed Topics are in ascending Class_Mastery order.

### Anonymisation (Requirement 8, Requirement 15)

14. **Identifier absence**: For all Class_Understanding_Map and Misconception_Report responses, the response contains no Learner_Id value and no Display_Name value.
15. **Threshold suppression**: For all Topics answered by fewer distinct Learners than the Anonymity_Threshold, the response omits the Class_Mastery value and reports insufficient-data.
16. **Single-learner non-disclosure**: For all Class_Sessions holding Quiz_Responses from exactly 1 Learner, no Class_Mastery value appears in the Class_Understanding_Map.

### Misconception detection (Requirement 9, Requirement 17)

17. **Threshold correctness**: For all sets of Quiz_Responses, a Distractor is a misconception candidate if and only if the selection percentage is at least 30 and the selecting Quiz_Response count is at least 2.
18. **Ranking and cap**: For all sets of Quiz_Responses, the retained misconception candidates are the highest-ranked candidates by selection percentage and number at most 3.
19. **Selection conservation**: For all Quiz_Items, the sum of selection counts across the 4 Answer_Options equals the count of Quiz_Responses persisted for the Quiz_Item, and every selection percentage lies within the range 0 to 100.

### Peer explanation gating (Requirement 11)

20. **Recommendation gating**: For all Study_Threads, every Peer_Explanation in Recommended_Explanations holds a Validation_Status of Validated.
21. **Pending exclusion**: For all Peer_Explanations holding a Validation_Status of Pending or Contradicted, the Peer_Explanation is absent from Recommended_Explanations.
22. **Retention**: For all submitted Peer_Explanations, the Peer_Explanation remains retrievable from the Study_Thread regardless of Validation_Status.
23. **Reason presence**: For all Peer_Explanations holding a Validation_Status of Contradicted or Unsupported, a reason of 1 to 300 characters is persisted.

### Grounding and schema (Requirement 5, Requirement 14)

24. **Quiz item well-formedness**: For all Quiz_Items in a Quiz_Pool, the Quiz_Item holds exactly 4 Answer_Options, exactly 1 correct Answer_Option, a Topic within the Class_Session Topics, and a Source_Reference.
25. **Reference resolvability**: For all Source_References attached to persisted content, the Source_Reference resolves to an existing location in the Source_Text of the Class_Session.
26. **Schema rejection**: For all Bedrock responses that fail schema validation, no content from the response is persisted.

### Fallback behaviour (Requirement 12)

27. **Reachability under failure**: For all single-task Bedrock failures, the Quiz view and the Class Insight view return a response without an error status.
28. **Deterministic paths unaffected**: For all Bedrock failure scenarios, the Understanding_Report Topic_Mastery values and the Class_Understanding_Map Class_Mastery values are computed and returned.

### Personalisation (Requirement 3, Requirement 4)

29. **Style conformance**: For all Learner_Profiles, every Recap_Section of the generated Recap satisfies the structural constraint declared for the selected Explanation_Style: Concise yields bullet points of 80 words or fewer, Detailed yields prose of 250 words or fewer, Examples yields at least one worked example, Step_By_Step yields an ordered sequence of numbered steps, and Visual_Structured yields a labelled table, an ordered pipeline of named stages, or a Mermaid_Diagram.
30. **Profile domain**: For all persisted Learner_Profiles, the Understanding_Level lies within the set {No_Understanding, Basic_Understanding, Strong_Understanding} and the Explanation_Style lies within the set {Concise, Detailed, Examples, Step_By_Step, Visual_Structured}, giving at most 15 retained Recap variants per Class_Session.
31. **Cache key totality**: For all triples of Class_Session, Understanding_Level, and Explanation_Style, the retained Recap lookup is a total function of the triple, so one triple never resolves to two different retained Recaps.
32. **Visual fallback availability**: For all Recap_Sections generated under the Visual_Structured Explanation_Style, a prose form of the Recap_Section content is persisted and retrievable.
