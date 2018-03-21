//
//  ViewController.swift
//  PracticeApp
//
//  Created by KimYong Ho on 2018. 3. 12..
//  Copyright © 2018년 KimYong Ho. All rights reserved.
//

import UIKit
import Firebase


class ViewController: UIViewController {
    
    //Mark: Constants
    let loginToList = "LoginToList"
    
    //Mark: Outlets
    @IBOutlet weak var textFieldLoginEmail: UITextField!
    @IBOutlet weak var textFieldLoginPassword: UITextField!

    @IBAction func loginDidTouch(_ sender: Any) {
    }
    @IBAction func signUpDidTouch(_ sender: Any) {
    }
    override func viewDidLoad() {
        super.viewDidLoad()
        
        createTf()
    }
    private func createTf() {
        let textFieldLoginEmail: UITextField = UITextField()
        textFieldLoginEmail.placeholder = "Enter your email"
        
        
        
        
        
        var textFieldLoginPassword: UITextField = UITextField()
        
    }
    
    private func createBtn() {
        var loginDidTouch: UIButton = UIButton()
        var signUpDidTouch: UIButton = UIButton()
    }
 

}

