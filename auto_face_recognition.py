#!/usr/bin/env python3
"""
Automated Face++ Facial Recognition System
Detects, captures, and verifies faces automatically with countdown timer
"""

import os
import time
import cv2
import numpy as np
from typing import Dict, Any, List, Tuple, Optional
from dotenv import load_dotenv
import tempfile
import requests
import datetime
import threading
import queue
import json

# Lazy import PIL only when needed for resizing
PIL_Image = None

def get_pil_image():
    global PIL_Image
    if PIL_Image is None:
        from PIL import Image
        PIL_Image = Image
    return PIL_Image

# Function to safely print text without emoji characters
def safe_print(text):
    """Print text safely without emoji characters that might cause encoding issues"""
    # Replace common emoji with text equivalents
    text = (text.replace("🔬", "[MICROSCOPE]")
                .replace("📸", "[CAMERA]")
                .replace("👀", "[EYES]")
                .replace("✅", "[OK]")
                .replace("❌", "[ERROR]")
                .replace("⚠️", "[WARNING]")
                .replace("🔍", "[SEARCH]")
                .replace("🗑️", "[DELETE]")
                .replace("⏱️", "[TIMER]"))
    
    # Print the clean text
    print(text)

class AutoFaceRecognition:
    def __init__(self, api_key: str, api_secret: str):
        """
        Initialize the automated facial recognition system
        
        Args:
            api_key: Your Face++ API key
            api_secret: Your Face++ API secret
        """
        self.api_key = api_key
        self.api_secret = api_secret
        self.base_url = "https://api-us.faceplusplus.com/facepp/v3"
        
        # Face detection parameters - lazy load cascade
        self.face_cascade = None
        
        # Capture parameters - optimized for immediate verification
        self.countdown_duration = 1  # reduced from 3 to 1 second
        self.min_face_size = (80, 80)  # reduced from (100, 100) for faster detection
        self.stability_threshold = 0.6  # reduced from 0.8 for faster capture
        self.min_confidence = 80.0  # minimum confidence for face verification
        self.capture_cooldown = 1  # reduced from 3 to 1 second between captures
        
        # Verification queue and thread
        self.verification_queue = queue.Queue()
        self.verification_thread = None
        self.stop_verification = False
        
        # Status tracking
        self.countdown_active = False
        self.countdown_start_time = 0
        self.last_capture_time = 0
        self.face_positions = []  # track face positions during countdown
        self.reference_images = {}
        self.captured_faces_dir = "Captured_Faces"
        
        # Verification results for display
        self.verification_results = None
        self.verification_display_time = 0
        self.verification_display_duration = 5  # seconds to display verification results
        
        # Reference directory
        self.reference_dir = "Reference_Images"
        
        # Image cleanup parameters
        self.image_retention_time = 60  # seconds to keep captured images (1 minute)
        self.cleanup_thread = None
        self.stop_cleanup = False
        self.captured_files = {}  # Dict of {filepath: timestamp}
        
    def _get_face_cascade(self):
        """Lazy load face cascade classifier"""
        if self.face_cascade is None:
            self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        return self.face_cascade
        
    def _resize_image_if_needed(self, image_path: str, max_size_kb: int = 1000) -> str:
        """
        Resize image if it's too large for the API
        
        Args:
            image_path: Path to the image file
            max_size_kb: Maximum file size in KB
            
        Returns:
            Path to the resized image or original if small enough
        """
        # Check file size
        file_size_kb = os.path.getsize(image_path) / 1024
        if file_size_kb <= max_size_kb:
            return image_path
            
        safe_print(f"Image is {file_size_kb:.1f}KB, resizing to fit API limits...")
        
        try:
            # Open and resize image
            Image = get_pil_image()
            img = Image.open(image_path)
            
            # Calculate new dimensions to maintain aspect ratio
            width, height = img.size
            scale_factor = 0.8  # Start with 80% reduction
            
            temp_file = None
            
            # Keep resizing until small enough
            while file_size_kb > max_size_kb and scale_factor > 0.1:
                new_width = int(width * scale_factor)
                new_height = int(height * scale_factor)
                resized_img = img.resize((new_width, new_height), Image.LANCZOS)
                
                # Save to temporary file
                temp_fd, temp_path = tempfile.mkstemp(suffix='.jpg')
                os.close(temp_fd)
                
                # Save with quality adjustment
                resized_img.save(temp_path, quality=85, optimize=True)
                
                # Check new file size
                file_size_kb = os.path.getsize(temp_path) / 1024
                
                # If still too large, try a smaller scale
                if file_size_kb > max_size_kb:
                    os.remove(temp_path)
                    scale_factor -= 0.1
                else:
                    # Clean up previous temp file if it exists
                    if temp_file and os.path.exists(temp_file):
                        os.remove(temp_file)
                    temp_file = temp_path
                    
            if temp_file:
                safe_print(f"Resized to {file_size_kb:.1f}KB")
                return temp_file
            else:
                safe_print("Could not resize image sufficiently")
                return image_path
                
        except Exception as e:
            safe_print(f"Error resizing image: {str(e)}")
            return image_path
    
    def save_frame_to_temp(self, frame) -> str:
        """
        Save a frame from webcam to a temporary file
        
        Args:
            frame: OpenCV frame
            
        Returns:
            Path to the saved image
        """
        temp_fd, temp_path = tempfile.mkstemp(suffix='.jpg')
        os.close(temp_fd)
        
        # Convert from BGR to RGB (OpenCV uses BGR by default)
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        Image = get_pil_image()
        img = Image.fromarray(rgb_frame)
        img.save(temp_path, quality=85)
        
        return temp_path
    
    def save_frame_to_file(self, frame, person_name: str = "unknown") -> str:
        """
        Save a frame to the captured faces directory
        
        Args:
            frame: OpenCV frame
            person_name: Name of the recognized person or "unknown"
            
        Returns:
            Path to the saved image
        """
        # Create directory if it doesn't exist
        if not os.path.exists(self.captured_faces_dir):
            os.makedirs(self.captured_faces_dir)
        
        # Generate filename with timestamp
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{person_name}_{timestamp}.jpg"
        filepath = os.path.join(self.captured_faces_dir, filename)
        
        # Save the image
        cv2.imwrite(filepath, frame)
        safe_print(f"Saved captured face to {filepath}")
        
        # Add to captured files for cleanup
        self.captured_files[filepath] = time.time()
        
        return filepath
        
    def compare_faces(self, image1_path: str, image2_path: str) -> Dict[str, Any]:
        """
        Compare two faces to determine if they belong to the same person
        
        Args:
            image1_path: Path to first image
            image2_path: Path to second image
            
        Returns:
            API response with confidence score
        """
        url = f"{self.base_url}/compare"
        
        data = {
            'api_key': self.api_key,
            'api_secret': self.api_secret
        }
        
        processed_image1_path = None
        processed_image2_path = None
        result = {}
        
        try:
            # Resize images if needed
            processed_image1_path = self._resize_image_if_needed(image1_path)
            processed_image2_path = self._resize_image_if_needed(image2_path)
            
            with open(processed_image1_path, 'rb') as image1, open(processed_image2_path, 'rb') as image2:
                files = {
                    'image_file1': image1,
                    'image_file2': image2
                }
                response = requests.post(url, data=data, files=files)
                response.raise_for_status()
                result = response.json()
                
        except FileNotFoundError as e:
            return {"error": f"Image file not found: {str(e)}"}
        except requests.exceptions.RequestException as e:
            return {"error": f"API request failed: {str(e)}"}
        finally:
            # Clean up temp files if created - after file handles are closed
            if processed_image1_path and processed_image1_path != image1_path and os.path.exists(processed_image1_path):
                try:
                    os.remove(processed_image1_path)
                except Exception:
                    pass
            
            if processed_image2_path and processed_image2_path != image2_path and os.path.exists(processed_image2_path):
                try:
                    os.remove(processed_image2_path)
                except Exception:
                    pass
        
        return result
    
    def verify_face(self, captured_image_path: str) -> Tuple[str, float]:
        """
        Verify a captured face against reference images
        
        Args:
            captured_image_path: Path to captured face image
            
        Returns:
            Tuple of (person_name, confidence)
        """
        highest_confidence = 0
        recognized_person = "Unknown"
        
        safe_print(f"Verifying captured face against {len(self.reference_images)} reference images...")
        
        # Compare with all reference images
        for person_name, ref_image_path in self.reference_images.items():
            safe_print(f"  Comparing with {person_name}...")
            result = self.compare_faces(captured_image_path, ref_image_path)
            
            if "error" not in result:
                confidence = result.get('confidence', 0)
                safe_print(f"  Confidence: {confidence:.1f}%")
                
                if confidence > highest_confidence:
                    highest_confidence = confidence
                    recognized_person = person_name
            else:
                safe_print(f"  Error: {result.get('error')}")
        
        # Return result based on confidence threshold
        verification_status = "VERIFIED" if highest_confidence >= self.min_confidence else "NOT VERIFIED"
        safe_print(f"Verification result: {verification_status} as {recognized_person} ({highest_confidence:.1f}%)")
        
        if highest_confidence >= self.min_confidence:
            return recognized_person, highest_confidence
        else:
            return "Unknown", highest_confidence
    
    def verification_worker(self):
        """
        Background worker to process verification queue
        """
        while not self.stop_verification:
            try:
                # Get item from queue with timeout to allow checking stop flag
                item = self.verification_queue.get(timeout=1)
                if item is None:
                    continue
                
                frame, temp_image_path = item
                
                # Verify the face
                person_name, confidence = self.verify_face(temp_image_path)
                
                # Save the frame with the person's name
                saved_path = self.save_frame_to_file(frame, person_name)
                
                # Store verification results for display
                self.verification_results = (person_name, confidence, frame.copy())
                self.verification_display_time = time.time()
                
                # Clean up temp file
                try:
                    if os.path.exists(temp_image_path):
                        os.remove(temp_image_path)
                except Exception:
                    pass
                
                # Mark task as done
                self.verification_queue.task_done()
                
            except queue.Empty:
                # Queue is empty, just continue
                continue
            except Exception as e:
                safe_print(f"Error in verification worker: {str(e)}")
    
    def cleanup_worker(self):
        """
        Background worker to clean up old captured images
        """
        while not self.stop_cleanup:
            try:
                current_time = time.time()
                files_to_delete = []
                
                # Find files to delete
                for filepath, timestamp in self.captured_files.items():
                    if current_time - timestamp > self.image_retention_time:
                        files_to_delete.append(filepath)
                
                # Delete files
                for filepath in files_to_delete:
                    try:
                        if os.path.exists(filepath):
                            os.remove(filepath)
                            safe_print(f"Deleted old captured image: {filepath}")
                        self.captured_files.pop(filepath)
                    except Exception as e:
                        safe_print(f"Error deleting file {filepath}: {str(e)}")
                
                # Sleep for a while
                time.sleep(5)
                
            except Exception as e:
                safe_print(f"Error in cleanup worker: {str(e)}")
                time.sleep(5)
    
    def calculate_face_stability(self, face_positions: List[Tuple[int, int, int, int]]) -> float:
        """
        Calculate how stable a face has been during countdown
        
        Args:
            face_positions: List of face positions (x, y, w, h)
            
        Returns:
            Stability score between 0 and 1
        """
        if len(face_positions) < 2:
            return 0.0
            
        # Calculate center points of each face position
        centers = [(x + w/2, y + h/2) for (x, y, w, h) in face_positions]
        
        # Calculate average center
        avg_x = sum(c[0] for c in centers) / len(centers)
        avg_y = sum(c[1] for c in centers) / len(centers)
        
        # Calculate average deviation from center
        total_deviation = sum(np.sqrt((c[0] - avg_x)**2 + (c[1] - avg_y)**2) for c in centers)
        avg_deviation = total_deviation / len(centers)
        
        # Convert to stability score (inverse of deviation)
        # Normalize by face size (average width and height)
        avg_size = sum((w + h)/2 for (_, _, w, h) in face_positions) / len(face_positions)
        
        # Calculate stability as percentage of face size
        stability = max(0, 1 - (avg_deviation / (avg_size * 0.5)))
        
        return stability
    
    def is_face_in_range(self, face_rect: Tuple[int, int, int, int]) -> bool:
        """
        Check if face is within the desired range (not too small)
        
        Args:
            face_rect: Face rectangle (x, y, w, h)
            
        Returns:
            True if face is in range, False otherwise
        """
        _, _, w, h = face_rect
        return w >= self.min_face_size[0] and h >= self.min_face_size[1]
    
    def load_reference_images(self) -> bool:
        """
        Load reference images from directory
        
        Args:
            reference_dir: Directory containing reference face images
            
        Returns:
            True if successful, False otherwise
        """
        # Check if reference directory exists
        if not os.path.isdir(self.reference_dir):
            safe_print(f"Reference directory '{self.reference_dir}' not found. Creating directory...")
            os.makedirs(self.reference_dir)
            safe_print(f"Please add reference images to '{self.reference_dir}' directory")
            safe_print("   Each image should contain one face and be named after the person")
            safe_print("   Example: 'john_smith.jpg'")
            return False
        
        # Get reference images
        self.reference_images = {}
        for filename in os.listdir(self.reference_dir):
            if filename.lower().endswith(('.png', '.jpg', '.jpeg')):
                person_name = os.path.splitext(filename)[0].replace('_', ' ').title()
                image_path = os.path.join(self.reference_dir, filename)
                self.reference_images[person_name] = image_path
        
        if not self.reference_images:
            safe_print(f"No reference images found in '{self.reference_dir}'")
            safe_print("   Please add reference images named after each person")
            safe_print("   Example: 'john_smith.jpg'")
            return False
        
        safe_print(f"Loaded {len(self.reference_images)} reference images")
        return True
    
    def start_verification_thread(self):
        """
        Start the background verification thread
        """
        self.stop_verification = False
        self.verification_thread = threading.Thread(target=self.verification_worker)
        self.verification_thread.daemon = True
        self.verification_thread.start()
    
    def stop_verification_thread(self):
        self.stop_verification = True
        if self.verification_thread and self.verification_thread.is_alive():
            self.verification_thread.join(timeout=2)
    
    def start_cleanup_thread(self):
        """
        Start the background cleanup thread
        """
        self.stop_cleanup = False
        self.cleanup_thread = threading.Thread(target=self.cleanup_worker)
        self.cleanup_thread.daemon = True
        self.cleanup_thread.start()
    
    def stop_cleanup_thread(self):
        """
        Stop the background cleanup thread
        """
        self.stop_cleanup = True
        if self.cleanup_thread and self.cleanup_thread.is_alive():
            self.cleanup_thread.join(timeout=2)
    
    def run(self, auto_close=False, result_file_path=None, fast_mode=True):
        """
        Run the automated facial recognition system
        
        Args:
            auto_close: Whether to automatically close after successful verification
            result_file_path: Path to save verification result as JSON
            fast_mode: Enable fast mode for immediate verification (skips some stability checks)
        """
        safe_print("\nStarting Automated Facial Recognition...")
        
        # Load reference images
        if not self.load_reference_images():
            return
        
        # Start verification thread
        self.start_verification_thread()
        
        # Start cleanup thread (only if not in fast mode to reduce overhead)
        if not fast_mode:
            self.start_cleanup_thread()
        
        # Initialize webcam with optimized settings
        try:
            cap = cv2.VideoCapture(0)
            if not cap.isOpened():
                safe_print("Could not open webcam")
                return
                
            # Set optimized resolution for faster processing
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)  # Reduced from 1280
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)  # Reduced from 720
            cap.set(cv2.CAP_PROP_FPS, 30)  # Set higher FPS for smoother experience
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # Reduce buffer size for lower latency
            
            # Warm up the camera by capturing a few frames
            for _ in range(3):
                ret, frame = cap.read()
                if not ret:
                    break
                    
        except Exception as e:
            safe_print(f"Error initializing webcam: {str(e)}")
            return
        
        mode_text = "Fast Mode - Immediate Verification" if fast_mode else "Normal Mode - Stability Checks"
        safe_print(f"\n{mode_text}")
        safe_print("Looking for faces... (Press 'q' to quit)")
        
        # Variables for auto-close
        verification_successful = False
        verification_result = None
        
        # Set timeout for auto-close mode
        start_time = time.time()
        timeout = 15 if fast_mode else 30  # Reduced timeout for fast mode
        
        # Main loop
        while True:
            # Capture frame
            ret, frame = cap.read()
            if not ret:
                safe_print("Failed to capture frame")
                break
                
            # Check if verification was successful and auto-close is enabled
            if auto_close and self.verification_results:
                person_name, confidence, _ = self.verification_results
                if confidence >= self.min_confidence:
                    verification_successful = True
                    verification_result = {
                        "success": True,
                        "person_name": person_name,
                        "confidence": confidence
                    }
                    
                    # Print result for IPC communication
                    result_json = json.dumps(verification_result)
                    print(f"VERIFICATION_COMPLETE: {result_json}", flush=True)
                    
                    # Save result to file if specified
                    if result_file_path:
                        try:
                            with open(result_file_path, 'w') as f:
                                f.write(result_json)
                            safe_print(f"Saved verification result to {result_file_path}")
                        except Exception as e:
                            safe_print(f"Error saving verification result: {str(e)}")
                    
                    # Break the loop to close
                    break
            
            # Check for timeout in auto-close mode
            if auto_close and (time.time() - start_time > timeout):
                safe_print(f"Timeout after {timeout} seconds")
                verification_result = {
                    "success": False,
                    "error": "Verification timed out"
                }
                
                # Print result for IPC communication
                result_json = json.dumps(verification_result)
                print(f"VERIFICATION_COMPLETE: {result_json}", flush=True)
                
                # Save result to file if specified
                if result_file_path:
                    try:
                        with open(result_file_path, 'w') as f:
                            f.write(result_json)
                        safe_print(f"Saved timeout result to {result_file_path}")
                    except Exception as e:
                        safe_print(f"Error saving timeout result: {str(e)}")
                
                # Break the loop to close
                break
            
            # Create display frame
            display_frame = frame.copy()
            h, w = frame.shape[:2]
            
            # Detect faces using OpenCV (faster than API)
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            face_cascade = self._get_face_cascade()
            faces = face_cascade.detectMultiScale(gray, 1.1, 3, minSize=self.min_face_size)
            
            # Get current time
            current_time = time.time()
            
            # Show basic UI
            ui_text = "Fast Face Recognition" if fast_mode else "Automated Face Recognition"
            cv2.putText(display_frame, ui_text, (10, 30), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            cv2.putText(display_frame, "Press 'q' to quit", (10, 60), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
            
            # Display verification results if available and within display time window
            if self.verification_results and (current_time - self.verification_display_time < self.verification_display_duration):
                person_name, confidence, _ = self.verification_results
                verified = confidence >= self.min_confidence
                
                # Draw verification result box
                result_box_y = h - 160
                result_box_height = 140
                
                # Draw semi-transparent background for result box
                overlay = display_frame.copy()
                cv2.rectangle(overlay, (10, result_box_y), (w-10, result_box_y + result_box_height), 
                             (0, 0, 0), -1)
                cv2.addWeighted(overlay, 0.7, display_frame, 0.3, 0, display_frame)
                
                # Draw verification results
                cv2.putText(display_frame, "Verification Results:", (20, result_box_y + 30), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
                
                # Display person name
                name_text = f"Person: {person_name}"
                cv2.putText(display_frame, name_text, (20, result_box_y + 70), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
                
                # Display confidence
                conf_text = f"Confidence: {confidence:.1f}%"
                cv2.putText(display_frame, conf_text, (20, result_box_y + 110), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
                
                # Display verification status
                status_text = "VERIFIED" if verified else "NOT VERIFIED"
                status_color = (0, 255, 0) if verified else (0, 0, 255)
                cv2.putText(display_frame, status_text, (w - 200, result_box_y + 70), 
                           cv2.FONT_HERSHEY_SIMPLEX, 1.0, status_color, 2)
            
            # Process detected faces
            if len(faces) > 0:
                # Get largest face (closest to camera)
                largest_face = max(faces, key=lambda rect: rect[2] * rect[3])
                x, y, w, h = largest_face
                
                # Draw rectangle around face
                cv2.rectangle(display_frame, (x, y), (x+w, y+h), (255, 0, 0), 2)
                
                # Check if face is in range
                if self.is_face_in_range(largest_face):
                    if fast_mode:
                        # Fast mode: immediate capture without stability checks
                        if current_time - self.last_capture_time > self.capture_cooldown:
                            safe_print("Fast mode: Capturing immediately...")
                            
                            # Save frame to temp file for verification
                            temp_path = self.save_frame_to_temp(frame)
                            
                            # Add to verification queue
                            self.verification_queue.put((frame.copy(), temp_path))
                            
                            # Update last capture time
                            self.last_capture_time = current_time
                            
                            # Show capture message
                            cv2.putText(display_frame, "Captured!", (x, y - 10), 
                                      cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                        else:
                            # Show cooldown message
                            cv2.putText(display_frame, "Processing...", (x, y - 10), 
                                      cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
                    else:
                        # Normal mode: Track face position for stability check
                        if self.countdown_active:
                            self.face_positions.append(largest_face)
                            
                            # Calculate time remaining
                            elapsed = current_time - self.countdown_start_time
                            remaining = max(0, self.countdown_duration - elapsed)
                            
                            if remaining > 0:
                                # Still counting down
                                cv2.putText(display_frame, f"Capturing in: {remaining:.1f}s", (x, y - 10), 
                                          cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
                            else:
                                # Countdown finished, check stability
                                stability = self.calculate_face_stability(self.face_positions)
                                
                                if stability >= self.stability_threshold:
                                    # Face was stable, capture it
                                    safe_print(f"Face stable ({stability:.2f}), capturing...")
                                    
                                    # Save frame to temp file for verification
                                    temp_path = self.save_frame_to_temp(frame)
                                    
                                    # Add to verification queue
                                    self.verification_queue.put((frame.copy(), temp_path))
                                    
                                    # Update last capture time
                                    self.last_capture_time = current_time
                                    
                                    # Show capture message
                                    cv2.putText(display_frame, "Captured!", (x, y - 10), 
                                              cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
                                else:
                                    # Face was not stable enough
                                    safe_print(f"Face not stable enough ({stability:.2f}), cancelling capture")
                                    cv2.putText(display_frame, "Too much movement", (x, y - 10), 
                                              cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                                
                                # Reset countdown
                                self.countdown_active = False
                                self.face_positions = []
                        
                        elif current_time - self.last_capture_time > self.capture_cooldown:
                            # Start new countdown
                            self.countdown_active = True
                            self.countdown_start_time = current_time
                            self.face_positions = [largest_face]
                            
                            safe_print("Face in range, starting countdown...")
                            cv2.putText(display_frame, "Starting countdown...", (x, y - 10), 
                                      cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
                else:
                    # Face is too small/far away
                    if self.countdown_active:
                        # Cancel countdown
                        safe_print("Face moved out of range, cancelling countdown")
                        self.countdown_active = False
                        self.face_positions = []
                    
                    cv2.putText(display_frame, "Move closer", (x, y - 10), 
                              cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            else:
                # No faces detected
                if self.countdown_active:
                    # Cancel countdown
                    safe_print("Face lost, cancelling countdown")
                    self.countdown_active = False
                    self.face_positions = []
            
            # Show the frame
            cv2.imshow('Automated Face Recognition', display_frame)
            
            # Exit on 'q' key press
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
        
        # Cleanup
        cap.release()
        cv2.destroyAllWindows()
        self.stop_verification_thread()
        if not fast_mode:
            self.stop_cleanup_thread()
        safe_print("Webcam released")

def main():
    """
    Main function to run the automated facial recognition system
    """
    try:
        # Load environment variables from .env file
        load_dotenv()
        
        safe_print("Automated Face Recognition System")
        safe_print("=" * 50)
        
        # Parse command-line arguments
        import argparse
        parser = argparse.ArgumentParser(description='Automated Face Recognition System')
        parser.add_argument('--reference-dir', type=str, help='Directory containing reference images')
        parser.add_argument('--captured-dir', type=str, help='Directory to save captured faces')
        parser.add_argument('--result-file', type=str, help='File to save verification result')
        parser.add_argument('--auto-close', action='store_true', help='Auto-close after successful verification')
        parser.add_argument('--fast-mode', action='store_true', default=True, help='Enable fast mode for immediate verification')
        parser.add_argument('--normal-mode', action='store_true', help='Use normal mode with stability checks')
        args = parser.parse_args()
        
        # Determine mode
        fast_mode = args.fast_mode and not args.normal_mode
        
        # Get API credentials from environment variables
        API_KEY = os.getenv("FACEPP_API_KEY", "")
        API_SECRET = os.getenv("FACEPP_API_SECRET", "")
        
        if not API_KEY or not API_SECRET or API_KEY == "YOUR_API_KEY_HERE" or API_SECRET == "YOUR_API_SECRET_HERE":
            safe_print("[ERROR] Please set FACEPP_API_KEY and FACEPP_API_SECRET in your .env file")
            safe_print("   Get them from: https://console.faceplusplus.com/")
            
            # Report error through JSON if result file is specified
            if args.result_file:
                error_result = {"success": False, "error": "API credentials not found"}
                with open(args.result_file, 'w') as f:
                    f.write(json.dumps(error_result))
                print(f"VERIFICATION_COMPLETE: {json.dumps(error_result)}", flush=True)
            return
        
        # Initialize the system
        system = AutoFaceRecognition(API_KEY, API_SECRET)
        
        # Set directories if provided
        if args.reference_dir:
            system.reference_dir = args.reference_dir
            safe_print(f"Using reference directory: {args.reference_dir}")
        
        if args.captured_dir:
            system.captured_faces_dir = args.captured_dir
            safe_print(f"Using captured faces directory: {args.captured_dir}")
        
        # Store result file path
        result_file_path = args.result_file if args.result_file else None
        
        # Print mode information
        mode_text = "Fast Mode (Immediate Verification)" if fast_mode else "Normal Mode (Stability Checks)"
        safe_print(f"Running in: {mode_text}")
        
        # Run the system with auto-close option if specified
        system.run(auto_close=args.auto_close, result_file_path=result_file_path, fast_mode=fast_mode)
    
    except Exception as e:
        # Handle any unexpected errors
        error_message = f"Unexpected error: {str(e)}"
        safe_print(f"[ERROR] {error_message}")
        
        # Report error through JSON if possible
        error_result = {"success": False, "error": error_message}
        
        try:
            if 'args' in locals() and args.result_file:
                with open(args.result_file, 'w') as f:
                    f.write(json.dumps(error_result))
            
            print(f"VERIFICATION_COMPLETE: {json.dumps(error_result)}", flush=True)
        except Exception:
            # Last resort error reporting
            print(f"VERIFICATION_COMPLETE: {json.dumps({'success': False, 'error': 'Fatal error'})}", flush=True)

if __name__ == "__main__":
    main() 