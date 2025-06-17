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
from PIL import Image
import tempfile
import requests
import datetime
import threading
import queue
import shutil

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
        
        # Face detection parameters
        self.face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
        
        # Capture parameters
        self.countdown_duration = 3  # seconds
        self.min_face_size = (100, 100)  # minimum face size to start countdown
        self.stability_threshold = 0.8  # how stable the face needs to be during countdown
        self.min_confidence = 80.0  # minimum confidence for face verification (updated to 80%)
        self.capture_cooldown = 3  # seconds between captures
        
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
            
        print(f"⚠️  Image is {file_size_kb:.1f}KB, resizing to fit API limits...")
        
        try:
            # Open and resize image
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
                print(f"✅ Resized to {file_size_kb:.1f}KB")
                return temp_file
            else:
                print("❌ Could not resize image sufficiently")
                return image_path
                
        except Exception as e:
            print(f"❌ Error resizing image: {str(e)}")
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
        print(f"✅ Saved captured face to {filepath}")
        
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
        
        print(f"🔍 Verifying captured face against {len(self.reference_images)} reference images...")
        
        # Compare with all reference images
        for person_name, ref_image_path in self.reference_images.items():
            print(f"  Comparing with {person_name}...")
            result = self.compare_faces(captured_image_path, ref_image_path)
            
            if "error" not in result:
                confidence = result.get('confidence', 0)
                print(f"  Confidence: {confidence:.1f}%")
                
                if confidence > highest_confidence:
                    highest_confidence = confidence
                    recognized_person = person_name
            else:
                print(f"  Error: {result.get('error')}")
        
        # Return result based on confidence threshold
        verification_status = "VERIFIED" if highest_confidence >= self.min_confidence else "NOT VERIFIED"
        print(f"✅ Verification result: {verification_status} as {recognized_person} ({highest_confidence:.1f}%)")
        
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
                print(f"❌ Error in verification worker: {str(e)}")
    
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
                            print(f"🗑️ Deleted old captured image: {filepath}")
                        self.captured_files.pop(filepath)
                    except Exception as e:
                        print(f"❌ Error deleting file {filepath}: {str(e)}")
                
                # Sleep for a while
                time.sleep(5)
                
            except Exception as e:
                print(f"❌ Error in cleanup worker: {str(e)}")
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
            print(f"⚠️  Reference directory '{self.reference_dir}' not found. Creating directory...")
            os.makedirs(self.reference_dir)
            print(f"✅ Please add reference images to '{self.reference_dir}' directory")
            print("   Each image should contain one face and be named after the person")
            print("   Example: 'john_smith.jpg'")
            return False
        
        # Get reference images
        self.reference_images = {}
        for filename in os.listdir(self.reference_dir):
            if filename.lower().endswith(('.png', '.jpg', '.jpeg')):
                person_name = os.path.splitext(filename)[0].replace('_', ' ').title()
                image_path = os.path.join(self.reference_dir, filename)
                self.reference_images[person_name] = image_path
        
        if not self.reference_images:
            print(f"⚠️  No reference images found in '{self.reference_dir}'")
            print("   Please add reference images named after each person")
            print("   Example: 'john_smith.jpg'")
            return False
        
        print(f"✅ Loaded {len(self.reference_images)} reference images")
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
    
    def run(self):
        """
        Run the automated facial recognition system
        """
        print("\n📸 Starting Automated Facial Recognition...")
        
        # Load reference images
        if not self.load_reference_images():
            return
        
        # Start verification thread
        self.start_verification_thread()
        
        # Start cleanup thread
        self.start_cleanup_thread()
        
        # Initialize webcam
        try:
            cap = cv2.VideoCapture(0)
            if not cap.isOpened():
                print("❌ Could not open webcam")
                return
                
            # Set landscape mode (higher width than height)
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        except Exception as e:
            print(f"❌ Error initializing webcam: {str(e)}")
            return
        
        print("\n👀 Looking for faces... (Press 'q' to quit)")
        
        # Main loop
        while True:
            # Capture frame
            ret, frame = cap.read()
            if not ret:
                print("❌ Failed to capture frame")
                break
            
            # Create display frame
            display_frame = frame.copy()
            h, w = frame.shape[:2]
            
            # Detect faces using OpenCV (faster than API)
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = self.face_cascade.detectMultiScale(gray, 1.3, 5)
            
            # Get current time
            current_time = time.time()
            
            # Show basic UI
            cv2.putText(display_frame, "Automated Face Recognition", (10, 30), 
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
                    # Track face position for stability check
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
                                print(f"✅ Face stable ({stability:.2f}), capturing...")
                                
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
                                print(f"❌ Face not stable enough ({stability:.2f}), cancelling capture")
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
                        
                        print("🔍 Face in range, starting countdown...")
                        cv2.putText(display_frame, "Starting countdown...", (x, y - 10), 
                                  cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
                else:
                    # Face is too small/far away
                    if self.countdown_active:
                        # Cancel countdown
                        print("❌ Face moved out of range, cancelling countdown")
                        self.countdown_active = False
                        self.face_positions = []
                    
                    cv2.putText(display_frame, "Move closer", (x, y - 10), 
                              cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            else:
                # No faces detected
                if self.countdown_active:
                    # Cancel countdown
                    print("❌ Face lost, cancelling countdown")
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
        self.stop_cleanup_thread()
        print("📷 Webcam released")

def main():
    """
    Main function to run the automated facial recognition system
    """
    # Load environment variables from .env file
    load_dotenv()
    
    print("🔬 Automated Face Recognition System")
    print("=" * 50)
    
    # Get API credentials from environment variables
    API_KEY = os.getenv("FACEPP_API_KEY", "")
    API_SECRET = os.getenv("FACEPP_API_SECRET", "")
    
    if not API_KEY or not API_SECRET or API_KEY == "YOUR_API_KEY_HERE" or API_SECRET == "YOUR_API_SECRET_HERE":
        print("❌ Please set FACEPP_API_KEY and FACEPP_API_SECRET in your .env file")
        print("   Get them from: https://console.faceplusplus.com/")
        return
    
    # Initialize the system
    system = AutoFaceRecognition(API_KEY, API_SECRET)
    
    # Run the system with default Reference_Images directory
    system.run()

if __name__ == "__main__":
    main() 